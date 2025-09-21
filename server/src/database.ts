import path from "path";
import { randomUUID } from "crypto";

import sqlite3 from "sqlite3";

const DATA_DIR = process.env.SERVER_DATA_DIR || "./data";
console.log(`Using directory ${DATA_DIR} for application data`);

sqlite3.verbose();
export const db = new sqlite3.Database(
  path.join(DATA_DIR, "data.sqlite3"),
  (error) => {
    if (error) {
      console.error("Failed to connect to sqlite3 database");
      console.error(`Error: ${error}`);
      console.error("Exiting");
      process.exit(1);
    }
    console.log("Connected to sqlite3 database");
    db.exec("PRAGMA foreign_keys = ON;", (error) => {
      if (error) {
        console.warn(
          "Failed to enable foreign_keys pragma in sqlite3 connection.",
        );
      } else {
        console.debug("Enabled foreign_keys pragma in sqlite3 connection.");
      }
    });
  },
);

export async function initializeDatabseIfNotInitialized(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='Users';",
      [],
      (error, row) => {
        if (error) {
          const msg =
            "Unexpected error when checking if database is initialized";
          console.error(msg);
          reject(msg);
        }
        if (row !== undefined) {
          // The DB is already initialized
          console.debug("Database is already initialized");
          resolve();
          return;
        }
        console.log("Databse not initiliazed. Initializing now.");
        db.exec(
          `
        CREATE TABLE Users (
          username STRING PRIMARY KEY,
          displayName STRING NOT NULL,
          password STRING NOT NULL
        );

        CREATE TABLE Documents (
          documentId STRING PRIMARY KEY,
          ownerUsername STRING NOT NULL REFERENCES Users(username) ON DELETE CASCADE,
          title STRING NOT NULL DEFAULT 'Document',
          isPublic BOOLEAN NOT NULL
        );

        CREATE INDEX idxOwnerUsernameOnDocuments ON Documents(ownerUsername);
          `,
          (error) => {
            if (error) {
              const msg =
                "Unexpected error when trying to initialize database.";
              console.error(msg);
              reject(msg);
              process.exit(1);
            } else resolve();
          },
        );
      },
    );
  });
}

async function getNewDocumentId(): Promise<string> {
  const newDocId = randomUUID();
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT 1 FROM Documents WHERE documentId=?",
      [newDocId],
      async (error, row) => {
        if (error) reject();
        else if (row === undefined) resolve(newDocId);
        else resolve(await getNewDocumentId());
      },
    );
  });
}

export async function newDocument(ownerUsername: string): Promise<string> {
  const newId: string = await getNewDocumentId();
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO Documents(documentId, ownerUsername, isPublic) VALUES(?, ?, ?);",
      [newId, ownerUsername, false],
      (error) => {
        if (error) reject();
        else resolve(newId);
      },
    );
  });
}

export async function checkAccess({
  username,
  documentId,
}: {
  username: string | null;
  documentId: string;
}): Promise<
  | { isLoggedIn: false; hasAccess: false }
  | { isLoggedIn: true; documentExists: false; hasAccess: false }
  | {
      isLoggedIn: true;
      documentExists: true;
      isPublic: boolean;
      isOwned: boolean;
      hasAccess: boolean;
    }
> {
  return new Promise((resolve, reject) => {
    if (username === null) resolve({ isLoggedIn: false, hasAccess: false });
    db.get(
      "SELECT ownerUsername, isPublic FROM Documents WHERE documentId = ?",
      [documentId],
      (
        error: Error | null,
        row: undefined | { ownerUsername: string; isPublic: boolean },
      ) => {
        if (error) {
          console.warn(
            `Unexpected error encountered when checking document access: ${error}`,
          );
          reject(error);
          return;
        }
        if (row === undefined) {
          resolve({
            isLoggedIn: true,
            documentExists: false,
            hasAccess: false,
          });
          return;
        }
        const isPublic = row.isPublic;
        const isOwned = row.ownerUsername == username;
        resolve({
          isLoggedIn: true,
          documentExists: true,
          isPublic,
          isOwned,
          hasAccess: isPublic || isOwned,
        });
      },
    );
  });
}

export async function updateDocumentVisibility({
  username,
  documentId,
  isPublic,
}: {
  username: string | null;
  documentId: string;
  isPublic: boolean;
}): Promise<void> {
  const accessDetails = await checkAccess({ username, documentId });
  return new Promise((resolve, reject) => {
    if (!accessDetails.isLoggedIn) {
      reject("not logged in");
      return;
    }
    if (!accessDetails.documentExists) {
      reject("invalid documentId");
      return;
    }
    if (!accessDetails.isOwned) {
      reject("not owned");
      return;
    }
    db.run(
      "UPDATE Documents SET isPublic=? WHERE documentId=?",
      [isPublic, documentId],
      (error) => {
        if (error) reject("unexpected error");
        else resolve();
      },
    );
  });
}
