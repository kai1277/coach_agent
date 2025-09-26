import { setupWorker } from "msw/browser";
import { handlers } from "./handlers.sessions";

export const worker = setupWorker(...handlers);
