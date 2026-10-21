// Reads the backend's published records from ../data (override with KDACE_DATA_DIR).
import { join } from "node:path";
import { Store } from "../../src/core/store.ts";

export const store = () => new Store(process.env.KDACE_DATA_DIR ?? join(process.cwd(), "..", "data"));
