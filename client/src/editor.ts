// import "./style.css";

import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { WebsocketProvider } from "y-websocket";
import { Doc } from "yjs";

const doc = new Doc();
const wsProvider = new WebsocketProvider(
  "ws://localhost:1234",
  "SAMPLE DOCUMENT ID",
  doc,
);
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
