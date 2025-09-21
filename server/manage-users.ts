import path from "node:path";

import sqlite3, { type Database } from "sqlite3";
import promptSync from "prompt-sync";
import bcrypt from "bcrypt";

const DATA_DIR = process.env.SERVER_DATA_DIR || "./data";
console.log(`Using directory ${DATA_DIR} for application data`);

const SALT_ROUNDS = 10;

const prompt = promptSync({
  sigint: true,
});

sqlite3.verbose();
function openDatabase(): sqlite3.Database {
  return new sqlite3.Database(path.join(DATA_DIR, "data.sqlite3"));
}

function getUsername(): string {
  const username: string = prompt("Enter username: ");
  if (username == null) {
    console.error("Please give a username.");
    process.exit(1);
  }
  return username;
}

function getPassword(): string {
  const password = prompt("Enter password for new user: ", { echo: "*" });
  if (password == null) {
    console.error("Please give a password.");
    process.exit(1);
  }
  return password;
}

let errorOccurred: boolean = false;

async function insertUserIntoDb(
  db: Database,
  username: string,
  hashedPassword: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO Users(username, password) VALUES (?, ?);",
      [username, hashedPassword],
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
  const username: string = process.argv[3] || getUsername();
  const plaintextPassword: string = getPassword();
  const hashedPassword: string = await bcrypt.hash(
    plaintextPassword,
    SALT_ROUNDS,
  );
  const db = openDatabase();
  await insertUserIntoDb(db, username, hashedPassword);
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
  const username: string = getUsername();
  const db = openDatabase();
  await deleteUserFromDb(db, username);
  db.close();
}

async function listUsersInDb(db: Database): Promise<void> {
  return new Promise((resolve, reject) => {
    db.all("SELECT username FROM Users;", [], (error, rows) => {
      if (error) {
        console.error("Failed to list users");
        errorOccurred = true;
        reject();
      } else {
        console.log("Users:");
        for (const row of rows) console.log(row.username);
        resolve();
      }
    });
  });
}

async function listUsers(): Promise<void> {
  const db = openDatabase();
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
