// Grill F8a / D16: v2 stores fail closed in every test file too. A DB-free test that exercises the in-memory
// double opts in explicitly with `allowV2MemoryStores()` (TEST-ONLY); nothing enables it globally.
import { allowV2MemoryStores } from "./packages/db/src/v2-persistence.ts";

allowV2MemoryStores(false);
