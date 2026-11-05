export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://zachary@localhost:5432/appointments_test_2";

const database = new URL(testDatabaseUrl).pathname.slice(1);
if (!/^appointments_test(?:_\d+)?$/.test(database)) {
  throw new Error(
    "TEST_DATABASE_URL must name an appointments_test[_ticket] database",
  );
}
