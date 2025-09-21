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
        if (error) {
          const msg = `Unexpected error in function getNewDocumentId(). error=${JSON.stringify(error)}`;
          console.warn(msg);
          reject();
        } else if (row === undefined) resolve(newDocId);
        else resolve(await getNewDocumentId());
      },
    );
  });
}

export async function newDocument(ownerUsername: string): Promise<string> {
  const newId: string = await getNewDocumentId();
  console.debug(`new document id found: ${newId}`);
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO Documents(documentId, ownerUsername, isPublic, title) VALUES(?, ?, ?, ?);",
      [newId, ownerUsername, false, "Document"],
      (error) => {
        if (error) {
          const msg = `Warning: unexpected error in function newDocument(ownerUsername): ${JSON.stringify(error)}`;
          reject(msg);
        } else resolve(newId);
      },
    );
  });
}

export type DocumentAccessDetail =
  | {
      isLoggedIn: false;
      hasAccess: false;
    }
  | {
      isLoggedIn: true;
      documentExists: false;
      hasAccess: false;
    }
  | {
      isLoggedIn: true;
      documentExists: true;
      isPublic: boolean;
      isOwned: boolean;
      hasAccess: boolean;
    };

export async function checkAccess({
  username,
  documentId,
}: {
  username: string | null;
  documentId: string;
}): Promise<DocumentAccessDetail> {
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

export async function getCorrectHashedPassword(
  username: string,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT password FROM Users WHERE username = ?",
      [username],
      async (error: Error | null, row: object | undefined) => {
        if (error) {
          return reject(
            "Unexpected error occurred when trying to fetch correct password for a user.",
          );
        }
        if (row === undefined) {
          return resolve(null);
        }
        const pass = row["password"];
        if (pass === undefined) {
          return reject(
            "Password column not found in row when trying to log in.",
          );
        }
        if (!(typeof pass === "string")) {
          return reject(
            "Password column of unexpected type when trying to log in.",
          );
        }
        return resolve(pass);
      },
    );
  });
}

export async function getDocumentTitle(
  documentId: string,
): Promise<string | null> {
  return new Promise<string>((resolve, reject) => {
    const sql = "SELECT title FROM Documents WHERE documentId = ?;";
    const params = [documentId];
    db.get(sql, params, (error: Error, row: object | undefined) => {
      if (error)
        return reject(
          `Unexpected error in getDocumentTitle(documentId) -> ${JSON.stringify(error)}`,
        );
      if (row === undefined) return resolve(null);
      const title = row["title"];
      if (title === undefined)
        return reject(
          "Required column title not found in sql response row in getDocumentTitle(documentId)",
        );
      if (typeof title !== "string")
        return reject(
          "Unexpected data type of 'title' column in sql response row in getDocumentTitle(documentId)",
        );
      return resolve(title);
    });
  });
}

export async function getUserDisplayName(username: string): Promise<string> {
  const sql = "SELECT displayName FROM Users WHERE username = ?;";
  const params = [username];
  return new Promise((resolve, reject) => {
    db.get(
      sql,
      params,
      (error: Error, row: { displayName: string } | undefined) => {
        if (error)
          return reject("Unexpected error in getUserDisplayName(username)");
        if (row === undefined)
          return reject(
            "username not found in db (in getUserDisplayName(username))",
          );
        resolve(row.displayName);
      },
    );
  });
}
