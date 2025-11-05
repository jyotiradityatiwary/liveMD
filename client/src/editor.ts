// import "./style.css";

import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { WebsocketProvider } from "y-websocket";
import { Doc } from "yjs";
import type { EditorPageDetails } from "../../server/server";

const doc = new Doc();
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const params = new URLSearchParams(window.location.search);

function getDocumentId(): string {
  const documentId: string | null = params.get("documentId");

  // redirect to home page if document is not selected
  if (documentId === null) {
    window.location.replace("/");
    return ""; // this line is unreachable
  } else {
    return documentId;
  }
}
const documentId = getDocumentId();
console.debug(`documentId = ${documentId}`);

export async function updateDocumentVisibility({
  isPublic,
}: {
  isPublic: boolean;
}) {
  const response = await fetch("/api/updateDocumentVisibility", {
    method: "post",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      documentId: documentId,
      isPublic: isPublic,
    }),
  });
  return await response.text();
}

async function getPageDetails(): Promise<EditorPageDetails> {
  const response = await fetch(
    "/api/getEditorPageDetails?" +
      new URLSearchParams({ documentId: documentId }),
    {
      method: "get",
    },
  );
  return await response.json();
}

const details = await getPageDetails();
const accessDetails = details.accessDetail;
console.debug(`documentAccess=${accessDetails}`);
if (!accessDetails.isLoggedIn) {
  alert("You are not logged in.");
  window.location.assign("/login");
} else if (!accessDetails.documentExists) {
  alert("This document ID does not exist.");
  window.location.replace("/");
} else if (!accessDetails.hasAccess) {
  alert("You do not have access to this document.");
  window.location.assign("/");
} else {
  const roomName: string = documentId;
  const wsServerUrl = `${wsProtocol}//${window.location.host}/api/documents`; // Connects to the same host

  const usercolors = [
    "#30bced",
    "#6eeb83",
    "#ffbc42",
    "#ecd444",
    "#ee6352",
    "#9ac2c9",
    "#8acb88",
    "#1be7ff",
  ];

    // set fetched details on page
    const userDetails = details.userDetails!;
    const userDisplayName = userDetails?.displayName ?? "Unauthenticated user";
    const userEmail = userDetails?.username ?? "";
    document.getElementById("account-name")!.textContent = userDisplayName;
    document.getElementById("account-email")!.textContent = userEmail;
    const documentTitleInputField = document.getElementById("document-title")!;
    documentTitleInputField.setAttribute("value", details.title ?? "Unknown Document Title");
    documentTitleInputField.onchange = async (event) => {
        // @ts-ignore
        const newTitle = event.target!.value;
        await fetch(
            "/api/updateDocumentTitle",
            {
                method: "post",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    documentId,
                    newTitle,
                }),
            },
        );
    }


  const wsProvider = new WebsocketProvider(wsServerUrl, roomName, doc);
  wsProvider.awareness.setLocalStateField("user", {
    ...wsProvider.awareness.getLocalState,
      name: userDisplayName,
    color: usercolors[Math.floor(Math.random() * usercolors.length)],
  });

  function updateWsStatus(status: "connected" | "connecting" | "disconnected") {
    console.debug(status);
  }

  wsProvider.on("status", (event) => {
    updateWsStatus(event.status);
  });

  setTimeout(() => {
    if (wsProvider.ws) {
      wsProvider.ws.onclose = (event) => {
        console.log("WebSocket connection closed.", event);
        if (!event.wasClean) {
          // The 'wasClean' property is false for abrupt closes like ws.terminate()
          alert(
            `Connection rejected or lost. Code: ${event.code}, Reason: ${event.reason}`,
          );
        }
      };

      wsProvider.ws.onerror = (event) => {
        console.error("WebSocket error observed:", event);
        // This event often fires just before the onclose event for rejected connections
      };
    }
  }, 1000);

  // Wait 1 second to give it time to connect/fail
  // wsProvider.on("connection-close", (event, provider) => {
  //   // if (event === null) return;
  //   alert("Connection closed by the server.");
  // });
  // wsProvider.on("connection-error", (event, provider) => {
  //   // if (event === null) return;
  //   alert("Error in connecting to the server.");
  // });

  const crepe = new Crepe({
    root: "#app",
    defaultValue: "Hello, LiveMD!",
  });
  crepe.editor.use(collab);

  await crepe.create();
  crepe.editor.action((ctx) => {
    const collabService = ctx.get(collabServiceCtx);
    collabService.bindDoc(doc);
    collabService.setAwareness(wsProvider.awareness);
    collabService.connect();
  });
}
