import path from "path";
import { randomUUID } from "crypto";

import sqlite3 from "sqlite3";
import {Doc} from "yjs";

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

export async function initializeDatabaseIfNotInitialized(): Promise<void> {
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
          username TEXT PRIMARY KEY,
          displayName TEXT NOT NULL,
          password TEXT NOT NULL
        ) STRICT;

        CREATE TABLE Documents (
          documentId TEXT PRIMARY KEY,
          ownerUsername TEXT NOT NULL REFERENCES Users(username) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT 'Document',
          isPublic INTEGER NOT NULL DEFAULT 0 CHECK (isPublic in (0, 1)),
          yDocData BLOB DEFAULT NULL,
          lastModified INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX DocumentsIdx ON Documents(ownerUsername, lastModified);
          `,
          (error) => {
            if (error) {
              const msg =
                "Unexpected error when trying to initialize database. error: " + JSON.stringify(error);
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
      "SELECT 1 FROM Documents WHERE documentId=?;",
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
      "INSERT INTO Documents(documentId, ownerUsername, isPublic, title, yDocData, lastModified) VALUES(?, ?, 0, 'Document', NULL, UNIXEPOCH('now'));",
      [newId, ownerUsername],
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
      "SELECT ownerUsername, isPublic FROM Documents WHERE documentId = ?;",
      [documentId],
      (
        error: Error | null,
        row: undefined | { ownerUsername: string; isPublic: number },
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
        const isPublic = row.isPublic != 0;
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
      [isPublic ? 1 : 0, documentId],
      (error) => {
        if (error) reject("unexpected error");
        else resolve();
      },
    );
  });
}

export async function updateDocumentTitle({
    username,
    documentId,
    newTitle,
}: {
    username: string | null;
    documentId: string;
    newTitle: string;
}): Promise<void> {
    const accessDetails = await checkAccess({username, documentId});
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
            "UPDATE Documents SET title=? WHERE documentId=?",
            [newTitle, documentId],
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
        if (!("password" in row)) {
          return reject(
            "Password column not found in row when trying to log in.",
          );
        }
        const pass = row["password"];
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
  return new Promise<string | null>((resolve, reject) => {
    const sql = "SELECT title FROM Documents WHERE documentId = ?;";
    const params = [documentId];
    db.get(sql, params, (error: Error, row: object | undefined) => {
      if (error)
        return reject(
          `Unexpected error in getDocumentTitle(documentId) -> ${JSON.stringify(error)}`,
        );
      if (row === undefined) return resolve(null);
      if (!('title' in row))
        return reject(
          "Required column title not found in sql response row in getDocumentTitle(documentId)",
        );
      const title = row["title"];
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

export type UserDocumentDetails = {
    documentId: string;
    title: string;
    lastModified: number;
};

export async function getDocumentDetailsForUser(username: string): Promise<UserDocumentDetails[]> {
    return new Promise<UserDocumentDetails[]>((resolve, reject) => {
        db.all(
            "SELECT documentId, title, lastModified FROM Documents WHERE ownerUsername = ? ORDER BY lastModified DESC;",
            [username],
            (error: Error | null, rows: UserDocumentDetails[]) => {
                if (error) return reject("unexpected sql error");
                return resolve(rows);
            }
        )
    })
}

export async function deleteDocument({
    username,
    documentId,
}: {
    username: string | null;
    documentId: string;
}): Promise<void> {
    // console.log(`deleteDocument(${JSON.stringify({
    //     username,
    //     documentId,
    // })})`);
    const accessDetails = await checkAccess({username, documentId});
    // console.log(`ACCESS DETAILS: ${JSON.stringify(accessDetails)}`);
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
            "DELETE FROM Documents WHERE documentId=?",
            [documentId],
            (error) => {
                if (error) reject("unexpected error");
                else resolve();
            },
        );
    });
}
