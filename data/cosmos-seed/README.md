# Cosmos seed data

Target: Azure Cosmos DB for NoSQL, account `3dprntdb`, database `3dprnt`, container `Items`.

This is a snapshot of the current app's local content: eight products, four actual categories, five FAQs, three services and three process steps (23 documents). The `All` category is a UI filter and is intentionally excluded. There are no stored orders, accounts, customer details or PayFast transactions to export. No credentials are included.

## Files

- `items.json`: all 23 documents as a JSON array, for tools supporting array imports.
- `items/`: one JSON object per file for individual uploads or New Item entry.
- `items.zip`: the individual JSON files, zipped for download. Extract before uploading.

## Import

1. Open Azure Portal → `3dprntdb` → Data Explorer → `3dprnt` → `Items` → Items.
2. Check the container's partition-key definition. These documents use the discussed single key `/ID` (uppercase). They also include lowercase `id`, which is Cosmos's document identifier. If your container uses a different property or hierarchical keys, confirm all required properties before importing; importing does not change the container definition.
3. If the Items toolbar offers Upload Item(s), select the extracted individual JSON files. Alternatively, select New Item, paste the contents of one file, and Save; repeat for the remaining files. Do not paste the entire array into the single New Item editor.
4. Verify the document count and sample records. If these identifiers already exist, review the existing records before choosing an overwrite/upsert option.

## Document fields

- `id`: stable string such as `product:1`.
- `ID`: partition value such as `product:1`; one root/group per record for this content snapshot.
- `EntityType`: `Product`, `Category`, `Faq`, `Service` or `ProcessStep`.
- `schemaVersion`: `1`, for future schema migration.
- `sortOrder`: display order within each entity type.
- Products retain the original numeric identifier as `productId`, and all original catalogue fields. `currency` must be `ZAR`; `priceCents` is the authoritative price used for display and checkout. `price` preserves the original rand amount for reference; update `priceCents` when changing the deployed price.
- Category `value` matches the existing product `category` value exactly.

The original catalogue prices and product content were checked against `src/data/catalogue.ts`. FAQs are copied from `src/components/HomeSections.tsx`, and service/process text matches that component. The export does not invent stock levels, order states, historical dates or transactions.

The deployed app reads these documents through the read-only content API. Importing them populates the data-driven sections on the next refresh (approximately ten seconds). With no valid documents or no database connection, those sections remain hidden; there is no deployed local-data fallback. The local development server uses this seed file for FAQs, services and process steps, and `src/data/catalogue.ts` for products/categories. The imported FAQs retain the current sandbox/file-upload limitations until those features are implemented.
