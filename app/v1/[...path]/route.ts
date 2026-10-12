import { handleTransactionApi } from "@/lib/transaction-api";

// All /v1/* endpoints of the transaction API; routing happens inside the handler.
export const GET = handleTransactionApi;
export const POST = handleTransactionApi;
