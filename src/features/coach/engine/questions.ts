import raw from "./questions.json";
import type { Question } from "./inference";

// JSON → 型安全に載せ替え（ビルド時にresolveJsonModuleが必要）
export const QUESTIONS: Question[] = raw as any as Question[];
