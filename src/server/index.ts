import "dotenv/config";
import express from "express";
import cors from "cors";
import seedQuestionsRoute from "./routes/seed-questions";

const app = express();
app.use(cors());
app.use(express.json());

// ルートだけ先に生やす（セッション系はあとで）
app.post("/api/sessions/:id/seed-questions", seedQuestionsRoute);

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
});
