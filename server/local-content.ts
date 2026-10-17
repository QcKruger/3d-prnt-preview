import { products, categories } from "../src/data/catalogue.ts";
import { parseContent } from "./content.ts";
import { readFileSync } from "node:fs";

// Local development only. Never included in the Windows deployment package.
const records = JSON.parse(
  readFileSync(
    new URL("../data/cosmos-seed/items.json", import.meta.url),
    "utf8",
  ),
);
export const localContent = {
  ...parseContent(records),
  products,
  categories: categories.filter((category) => category.value !== "All"),
};
