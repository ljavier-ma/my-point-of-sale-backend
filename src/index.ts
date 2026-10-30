// index.ts
import express from "express";

import { storeMiddleware } from "#middlewares/store.middleware.js";
import { firebaseAuthMiddleware } from "#services/firebase-auth.service.js";

const app = express();
const port = process.env.PORT ?? "9001";

app.get("/store", firebaseAuthMiddleware, storeMiddleware);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
