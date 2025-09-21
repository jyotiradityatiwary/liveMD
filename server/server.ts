import express from "express";
import cookieSession from "cookie-session";
import bcrypt from "bcrypt";
import { body, query, validationResult } from "express-validator";
import expressWs from "express-ws";
import { setupWSConnection } from "@y/websocket-server/utils";

import {
  db,
  initializeDatabseIfNotInitialized,
  newDocument,
  checkAccess,
  updateDocumentVisibility,
} from "./src/database.ts";

const SALT_ROUNDS = 10;

initializeDatabseIfNotInitialized();

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
  (request: express.Request, response: express.Response) => {
    const validationErrors = validationResult(request);
    if (!validationErrors.isEmpty()) {
      return response.status(400).json({ errors: validationErrors.array() });
    }
    const username = request.body.username;
    const password: string = request.body.password as string;
    db.get(
      "SELECT password FROM Users WHERE username = ?",
      [username],
      async (error: Error | null, row: object | undefined) => {
        if (error) {
          console.error(
            "Unexpected error occurred when trying to fetch correct password for a user.",
          );
          response.sendStatus(500);
          return;
        }
        if (row === undefined) {
          console.debug("Username not found in database in login attempt.");
          response.redirect("/login?retry=true");
          return;
        }
        if (!("password" in row)) {
          console.error(
            "Password column not found in row when trying to log in.",
          );
          response.sendStatus(500);
          return;
        }
        if (!(typeof row.password === "string")) {
          console.error(
            "Password column of unexpected type when trying to log in.",
          );
          response.sendStatus(500);
          return;
        }
        const correctHashedPassword = row.password;
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

app.post("/api/newDocument", async (request, response) => {
  if (!request.session || !request.session.username) {
    response.redirect("/login");
    return;
  }
  const newDocumentId: string = await newDocument(request.session!.username);
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
