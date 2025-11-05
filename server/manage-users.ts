import { type Database } from "sqlite3";
import promptSync from "prompt-sync";
import bcrypt from "bcrypt";

import { db, initializeDatabaseIfNotInitialized } from "./src/database.ts";

const SALT_ROUNDS = 10;

const prompt = promptSync({
  sigint: true,
});

function getText(promptMessage: string): string {
  const input: string = prompt(promptMessage);
  if (input == null) {
    console.error("Error: Expected text input..");
    process.exit(1);
  }
  return input;
}

function getPassword(): string {
  const password = prompt("Enter password for new user: ", { echo: "*" });
  if (password == null) {
    console.error("Error: expected text input");
    process.exit(1);
  }
  return password;
}

let errorOccurred: boolean = false;

async function insertUserIntoDb(
  db: Database,
  username: string,
  hashedPassword: string,
  displayName: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO Users(username, password, displayName) VALUES (?, ?, ?);",
      [username, hashedPassword, displayName],
      (error) => {
        if (error) {
          console.error("Failed to add user");
          errorOccurred = true;
          reject("Unexpected error");
        } else resolve();
      },
    );
  });
}

async function createUser(): Promise<void> {
  const username: string =
    process.argv[3] || getText("Enter username for new user: ");
  const displayName = getText("Enter display name for new user: ");
  const plaintextPassword: string = getPassword();
  const hashedPassword: string = await bcrypt.hash(
    plaintextPassword,
    SALT_ROUNDS,
  );
  await initializeDatabaseIfNotInitialized();
  await insertUserIntoDb(db, username, hashedPassword, displayName);
  db.close();
}

async function deleteUserFromDb(db: Database, username: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM Users WHERE username=?;", [username], (error) => {
      if (error) {
        console.error("Failed to delete user.");
        errorOccurred = true;
        reject();
      } else resolve();
    });
  });
}

async function deleteUser(): Promise<void> {
  const username: string = getText("Enter username: ");
  await initializeDatabaseIfNotInitialized();
  await deleteUserFromDb(db, username);
  db.close();
}

async function listUsersInDb(db: Database): Promise<void> {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT username, displayName FROM Users;",
      [],
      (error, rows: object[]) => {
        if (error) {
          console.error("Failed to list users");
          errorOccurred = true;
          reject();
        } else {
          console.log("Users:");
          for (const row of rows) {
            if ("username" in row && "displayName" in row)
              console.log(`${row.username} (${row.displayName})`);
            else {
              console.error(
                "Unexpected row returned from sql query to list users. Exiting.",
              );
              errorOccurred = true;
              reject();
              return;
            }
          }
          resolve();
        }
      },
    );
  });
}

async function listUsers(): Promise<void> {
  await initializeDatabaseIfNotInitialized();
  await listUsersInDb(db);
  db.close();
}

switch (process.argv[2]) {
  case undefined:
    console.error("Please give a command");
    errorOccurred = true;
    break;
  case "create":
    await createUser();
    break;
  case "delete":
    await deleteUser();
    break;
  case "list":
    await listUsers();
    break;
  default:
    console.error("Invalid command");
    errorOccurred = true;
    break;
}

process.exit(errorOccurred ? 1 : 0);
