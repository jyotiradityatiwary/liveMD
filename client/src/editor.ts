// import "./style.css";

import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { WebsocketProvider } from "y-websocket";
import { Doc } from "yjs";

const doc = new Doc();
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const params = new URLSearchParams(window.location.search);
const documentId: string | null = params.get("documentId");
// redirect to home page if document is not selected
if (documentId === null) window.location.replace("/");
const roomName: string = documentId as string;
const wsServerUrl = `${wsProtocol}//${window.location.host}/api/documents`; // Connects to the same host

const wsProvider = new WebsocketProvider(wsServerUrl, roomName, doc);
let wsStatus: "connected" | "connecting" | "disconnected" = "disconnected";
function updateWsStatus(status: "connected" | "connecting" | "disconnected") {
  alert(status);
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
