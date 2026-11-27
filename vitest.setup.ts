// Grill F8a / D16: v2 stores fail closed in production; test files opt into the in-memory double explicitly.
import { allowV2MemoryStores } from "./packages/db/src/v2-persistence.ts";

allowV2MemoryStores();
