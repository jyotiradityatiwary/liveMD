import path from "path";

import express from "express";
import cookieSession from "cookie-session";
import sqlite3 from "sqlite3";
import bcrypt from "bcrypt";
import { query, validationResult } from "express-validator";
import expressWs from "express-ws";
import { setupWSConnection } from "@y/websocket-server/utils";

const SALT_ROUNDS = 10;

const DATA_DIR = process.env.SERVER_DATA_DIR || "./data";
console.log(`Using directory ${DATA_DIR} for application data`);

sqlite3.verbose();
const db = new sqlite3.Database(path.join(DATA_DIR, "data.sqlite3"));

function initializeDatabseIfNotInitialized(): void {
  db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='Users';",
    [],
    (error, row) => {
      if (error) {
        console.error(
          "Unexpected error when checking if database is initialized",
        );
        process.exit(1);
      }
      if (row !== undefined) {
        // The DB is already initialized
        console.debug("Database is already initialized");
        return;
      }
      console.log("Databse not initiliazed. Initializing now.");
      db.exec(
        `
        CREATE TABLE Users (
          username STRING PRIMARY KEY,
          password STRING NOT NULL
        );

        CREATE TABLE Documents (
          documentId STRING PRIMARY KEY,
          ownerUsername STRING NOT NULL REFERENCES Users(username),
          isPublic BOOLEAN NOT NULL
        );

        CREATE INDEX idxOwnerUsernameOnDocuments ON Documents(ownerUsername);
          `,
        (error) => {
          if (error) {
            console.error(
              "Unexpected error when trying to initialize database.",
            );
            process.exit(1);
          }
        },
      );
    },
  );
}
initializeDatabseIfNotInitialized();

async function doesUserHaveAccess(
  username: string,
  documentId: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!username || !documentId) resolve(false);
    db.get(
      "SELECT ownerUsername, isPublic FROM Documents WHERE documentId = ?",
      [documentId],
      (error, row) => {
        if (error) reject(error);
        if (row === undefined) resolve(false);
        resolve(row.isPublic === true || row.ownerUsername === username);
      },
    );
  });
}

if (!process.env.COOKIE_SECRET) {
  console.warn(
    "Environment variable COOKIE_SECRET not specified. Using default secret (insecure).",
  );
}

const { app } = expressWs(express());

app.use(express.json());
app.use(
  cookieSession({
    name: "session",
    secret: process.env.EXPRESS_SECRET || "DEFAULT COOKIE SECRET xsalkjxn12oin",
    sameSite: "strict",
    httpOnly: true,
    signed: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  }),
);
const PORT = process.env.PORT || 3000;

app.get("/api/status", (request, response) => {
  response.send({ status: "running" });
});

app.post(
  "/api/login",
  [
    query("username")
      .notEmpty()
      .withMessage("username cannot be empty")
      .isString()
      .withMessage("username must be a string"),
    query("password")
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
    const username = request.query.username;
    const password: string = request.query.password as string;
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
          // user not present
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
          request.sesssion.username = username;
          response.redirect("/");
        } else {
          response.redirect("/login?retry=true");
        }
      },
    );
  },
);
app.get("/api/validateLogin", (request, response: express.Response) => {
  if (!request.session) {
    response.json({ hasSession: true, isLoggedIn: false });
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

app.ws("/api/documents/:documentId", async (ws, request) => {
  if (request.session === null || !("username" in request.session)) {
    // User is not authenticated
    console.log("Rejected unauthorized websocket connection attempt");
    ws.terminate();
    return;
  }
  const username = request.session.username;
  const documentId = request.params.documentId;
  if (!(await doesUserHaveAccess(username, documentId))) {
    // User does not have access to this document
    console.log(
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
