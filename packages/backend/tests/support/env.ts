import { testDatabaseUrl } from "./db-url";

// Services read DATABASE_URL lazily; point them at the disposable test DB.
process.env.DATABASE_URL = testDatabaseUrl();
