import express, {response} from "express";
import cookieSession from "cookie-session";
import bcrypt from "bcrypt";
import { body, query, validationResult } from "express-validator";
import expressWs from "express-ws";
import {setupWSConnection, setPersistence} from "@y/websocket-server/utils";
import * as Y from 'yjs';

import {
    db,
    initializeDatabaseIfNotInitialized,
    newDocument,
    checkAccess,
    updateDocumentVisibility,
    type DocumentAccessDetail,
    getDocumentTitle,
    getCorrectHashedPassword,
    getUserDisplayName, updateDocumentTitle, getDocumentDetailsForUser, type UserDocumentDetails, deleteDocument,
} from "./src/database.ts";

const SALT_ROUNDS = 10;

await initializeDatabaseIfNotInitialized();

setPersistence({
    provider: db, // 👈 **Add this line**
    bindState: async (docName: string, ydoc: Y.Doc) => {
        // This function is called when a document is loaded into memory
        console.log(`[Yjs] Loading document: ${docName}`);

        try {
            // 1. Retrieve the document from your SQLite database
            const row: { yDocData: Uint8Array } | undefined = await new Promise(
                (resolve, reject) => {
                    db.get(
                        "SELECT yDocData FROM Documents WHERE documentId = ?;",
                        [docName],
                        (err, row) => {
                            if (err) return reject(err);
                            resolve(row as { yDocData: Uint8Array } | undefined);
                        },
                    );
                },
            );

            // 2. If the document exists, apply its data to the in-memory ydoc
            if (row && row.yDocData) {
                Y.applyUpdate(ydoc, new Uint8Array(row.yDocData));
                console.log(`[Yjs] Restored document: ${docName}`);
            } else {
                console.log(`[Yjs] New document: ${docName}`);
            }
        } catch (e) {
            console.error(`[Yjs] Failed to bind state for ${docName}:`, e);
        }

        // 3. Add an 'update' listener to save changes back to the DB
        ydoc.on("update", async (update: Uint8Array) => {
            console.log(`[Yjs] Persisting update for: ${docName}`);
            try {
                await new Promise<void>((resolve, reject) => {
                    db.run(
                        "UPDATE Documents SET yDocData = ?, lastModified = UNIXEPOCH('now') WHERE documentId = ?;",
                        [Buffer.from(update), docName], // Store as buffer/blob
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        },
                    );
                });
            } catch (e) {
                console.error(`[Yjs] Failed to save update for ${docName}:`, e);
            }
        });
    },
    writeState: async (docName: string, ydoc: Y.Doc) => {
        // This function is called when a document is being unloaded from memory
        console.log(`[Yjs] Writing final state for: ${docName}`);
        try {
            // Get the full document state as a single update
            const finalState = Y.encodeStateAsUpdate(ydoc);

            // Store it in the database, replacing any existing entry
            await new Promise<void>((resolve, reject) => {
                db.run(
                    "UPDATE Documents SET yDocData = ?, lastModified = UNIXEPOCH('now') WHERE documentId = ?;",
                    [Buffer.from(finalState), docName],
                    (err) => {
                        if (err) return reject(err);
                        resolve();
                    },
                );
            });
            console.log(`[Yjs] Successfully wrote final state for: ${docName}`);
        } catch (e) {
            console.error(`[Yjs] Failed to write final state for ${docName}:`, e);
        }
    },
});

if (!process.env.COOKIE_SECRET) {
  console.warn(
    "Environment variable COOKIE_SECRET not specified. Using default secret (insecure).",
  );
}

const { app } = expressWs(express());
app.use(
  cookieSession({
    name: "session",
    secret: process.env.EXPRESS_SECRET || "DEFAULT COOKIE SECRET xsalkjxn12oin",
    // sameSite: "strict",
    // httpOnly: true,
    signed: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

app.get("/api/status", (request, response) => {
  response.send({ status: "running" });
});

app.post(
  "/api/login",
  [
    body("username")
      .notEmpty()
      .withMessage("username cannot be empty")
      .isString()
      .withMessage("username must be a string"),
    body("password")
      .notEmpty()
      .withMessage("password cannot be empty")
      .isString()
      .withMessage("password must be a string"),
  ],
  async (request: express.Request, response: express.Response) => {
    const validationErrors = validationResult(request);
    if (!validationErrors.isEmpty()) {
      return response.status(400).json({ errors: validationErrors.array() });
    }
    const username = request.body.username;
    const password: string = request.body.password as string;

    const correctHashedPassword = await getCorrectHashedPassword(username);
    if (correctHashedPassword === null) {
      return response.redirect("/login?retry=true");
    }
    const passwordMatch: boolean = await bcrypt.compare(
      password,
      correctHashedPassword,
    );
    if (passwordMatch) {
      console.debug(`username:${username} logged in`);
      request.session!.username = username;
      response.redirect("/");
    } else {
      console.debug("Password mismatch in login attempt");
      response.redirect("/login?retry=true");
    }
  },
);

app.get("/api/validateLogin", (request, response: express.Response) => {
  console.log(request.session);
  if (!request.session) {
    response.json({ hasSession: false, isLoggedIn: false });
    return;
  }
  if (
    !request.session.username ||
    typeof request.session.username !== "string"
  ) {
    response.json({
      hasSession: true,
      isSessionValid: false,
      isLoggedIn: false,
    });
    return;
  }
  response.json({
    hasSession: true,
    isSessionValid: true,
    isLoggedIn: true,
    username: request.session.username,
  });
});

app.post(
  "/api/logout",
  (request: express.Request, response: express.Response) => {
    request.session = null;
    response.redirect("/login");
  },
);

function isUserLoggedIn(request: express.Request): boolean {
  return (request.session && "username" in request.session && true) || false;
}

function getUsername(request: express.Request): string | null {
  return isUserLoggedIn(request) ? request.session!.username : null;
}

app.ws("/api/documents/:documentId", async (ws, request) => {
  const username = getUsername(request);
  const documentId = request.params.documentId;
    if (documentId === undefined) return response.status(400).json({error: 'empty documentId'});
  const accessDetail = await checkAccess({ username, documentId });
  if (!accessDetail.hasAccess) {
    // User does not have access to this document
    console.debug(
      "Rejected attempt to establish websocket connection on a document that the user does not have access to.",
    );
    ws.terminate();
    return;
  }

  // grant access
  console.debug(
    `Granting access for documentId=${documentId} to username=${username}`,
  );
  setupWSConnection(ws, request, {
    docName: request.params.documentId,
  });
});

app.post(
    '/api/deleteDocument',
    [
        body('documentId')
            .notEmpty()
            .withMessage('documentId cannot be empty')
            .isString()
            .withMessage('documentId must be a string'),
    ],
    async (request: express.Request, response: express.Response) => {
        const validationErrors = validationResult(request);
        if (!validationErrors.isEmpty()) {
            return response.status(400).json({errors: validationErrors.array()});
        }
        const username = getUsername(request);
        const documentId = request.body.documentId!;
        deleteDocument({
            username,
            documentId
        })
            .then(() => response.sendStatus(200))
            .catch((error) => response.status(400).json({error}));
    }
);

app.post("/api/newDocument", async (request, response) => {
  if (!request.session || !request.session.username) {
    response.redirect("/login");
    return;
  }
  const newDocumentId: string = await newDocument(request.session.username);
  response.redirect(`/editor?documentId=${newDocumentId}`);
});

app.get(
  "/api/checkAccess",
  [
    query("documentId")
      .notEmpty()
      .withMessage("documentId cannot be empty")
      .isString()
      .withMessage("documentId must be a string"),
  ],
  async (request: express.Request, response: express.Response) => {
    const validationErrors = validationResult(request);
    if (!validationErrors.isEmpty()) {
      response.status(400).json({ errors: validationErrors.array() });
      return;
    }
    const documentId = request.query.documentId as string;
    const username = getUsername(request);
    const accessDetails = await checkAccess({ username, documentId });
    response.json(accessDetails);
  },
);

app.post(
  "/api/updateDocumentVisibility",
  [
    body("documentId")
      .notEmpty()
      .withMessage("documentId cannot be empty")
      .isString()
      .withMessage("documentId must be a string"),
    body("isPublic")
      .notEmpty()
      .withMessage("isPublic cannot be empty")
      .isBoolean()
      .withMessage("isPublic must be a boolean"),
  ],
  async (request: express.Request, response: express.Response) => {
    const validationErrors = validationResult(request);
    if (!validationErrors.isEmpty()) {
      response.status(400).json({ errors: validationErrors.array() });
      return;
    }
    const username: string | null = getUsername(request);
    const documentId: string = request.body.documentId;
    const isPublic: boolean = request.body.isPublic;
    updateDocumentVisibility({ username, documentId, isPublic })
      .then(() => response.sendStatus(200))
      .catch((error) => response.json({ error: error }));
  },
);

app.post(
    "/api/updateDocumentTitle",
    [
        body("documentId")
            .notEmpty()
            .withMessage("documentId cannot be empty")
            .isString()
            .withMessage("documentId must be a string"),
        body("newTitle")
            .notEmpty()
            .withMessage("newTitle cannot be empty")
            .isString()
            .withMessage("newTitle must be a string"),
    ],
    async (request: express.Request, response: express.Response) => {
        const validationErrors = validationResult(request);
        if (!validationErrors.isEmpty()) {
            response.status(400).json({errors: validationErrors.array()});
            return;
        }
        const username: string | null = getUsername(request);
        const documentId: string = request.body.documentId;
        const newTitle: string = request.body.newTitle;
        updateDocumentTitle({username, documentId, newTitle})
            .then(() => response.sendStatus(200))
            .catch((error) => response.json({error: error}));
    },
);

export type EditorPageDetails = {
  accessDetail: DocumentAccessDetail;
  userDetails: UserDetails | null;
  title: string | null;
};

type UserDetails = {
  username: string;
  displayName: string;
};

async function getUserDetails(username: string): Promise<UserDetails> {
  const displayName = await getUserDisplayName(username);
  return { username, displayName };
}

app.get(
  "/api/getEditorPageDetails",
  [query("documentId").notEmpty().isString()],
  async (request: express.Request, response: express.Response) => {
    const validationErrors = validationResult(request);
    if (!validationErrors.isEmpty()) {
      response.status(400).json({ errors: validationErrors.array() });
      return;
    }
    const documentId = request.query.documentId as string;
    const username: string | null = getUsername(request);
    const accessDetail = await checkAccess({
      documentId: documentId,
      username: username,
    });
    const details: EditorPageDetails = {
      accessDetail: accessDetail,
      title: accessDetail.hasAccess ? await getDocumentTitle(documentId) : null,
      userDetails: username === null ? null : await getUserDetails(username),
    };
    return response.json(details);
  },
);

export type HomePageDetails = {
    username: string;
    displayName: string;
    documents: UserDocumentDetails[];
}

app.get(
    '/api/getHomePageDetails',
    async (request, response) => {
        const username: string | null = getUsername(request);
        if (username === null) return response.redirect('/login')
        const documents = await getDocumentDetailsForUser(username);
        const displayName = await getUserDisplayName(username);
        const homePageDetails: HomePageDetails = {
            username,
            displayName,
            documents,
        };
        return response.set('Cache-Control', 'no-store').json(homePageDetails);
    }
)

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Function to handle server shutdown
function shutdown(): void {
  console.log("Initiating server shutdown...");
  server.close(() => {
    console.log("Server closed successfully. Performing cleanup...");
    db.close();
    process.exit(0); // Exit the process after cleanup
  });
}

// Listen for shutdown signals
process.on("SIGTERM", shutdown); // Handle termination signal
process.on("SIGINT", shutdown); // Handle interrupt signal (Ctrl+C)
