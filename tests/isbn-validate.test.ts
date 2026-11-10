import assert from "node:assert/strict";
import test from "node:test";
import type { IsbnMetadata, SourceResult } from "../src/isbn-validate.js";
import {
  authorScore,
  comparableTitle,
  compareMetadata,
  parseGoogleBooksVolume,
  parseOpenLibraryBook,
  publisherMatches,
  validateWork
} from "../src/isbn-validate.js";
import type { Work } from "../src/types.js";

function work(partial: Partial<Work> & Pick<Work, "key" | "title" | "author">): Work {
  return {
    series: "",
    volume: 1,
    status: "Want to Read",
    language: "en",
    priority: 1,
    enabled: true,
    aliases: [],
    preferred_publishers: [],
    preferred_formats: ["hardcover", "paperback"],
    isbn13: "",
    max_price: 150,
    notes: "",
    ...partial
  };
}

const wayOfKings = work({
  key: "the-way-of-kings--brandon-sanderson",
  title: "The Way of Kings",
  author: "Brandon Sanderson",
  series: "The Stormlight Archive",
  preferred_publishers: ["Tor"],
  isbn13: "9780765326355"
});

const dune = work({
  key: "dune--frank-herbert",
  title: "Dune",
  author: "Frank Herbert",
  preferred_publishers: ["Ace", "Berkley"],
  isbn13: "9780425038918"
});

function metadata(partial: Partial<IsbnMetadata>): IsbnMetadata {
  return {
    source: "openlibrary",
    title: "",
    authors: [],
    publisher: "",
    publishedDate: "",
    language: "",
    ...partial
  };
}

function source(partial: Partial<SourceResult>): SourceResult {
  return { found: true, metadata: null, error: null, ...partial };
}

test("comparableTitle remove subtítulo genérico e parênteses", () => {
  assert.equal(
    comparableTitle("The Way of Kings: Book One of the Stormlight Archive"),
    "The Way of Kings"
  );
  assert.equal(comparableTitle("Mistborn: The Final Empire"), "Mistborn: The Final Empire");
  assert.equal(comparableTitle("Dune: Messiah"), "Dune: Messiah");
  assert.equal(comparableTitle("Children of Dune (Dune Chronicles, Book 3)"), "Children of Dune");
});

test("parseOpenLibraryBook lê título, autores, editora e data", () => {
  const parsed = parseOpenLibraryBook("9780765326355", {
    "ISBN:9780765326355": {
      title: "The Way of Kings",
      subtitle: "Book One of the Stormlight Archive",
      authors: [{ name: "Brandon Sanderson" }],
      publishers: [{ name: "Tor" }],
      publish_date: "August 31st 2010"
    }
  });
  assert.ok(parsed);
  assert.equal(parsed?.title, "The Way of Kings: Book One of the Stormlight Archive");
  assert.deepEqual(parsed?.authors, ["Brandon Sanderson"]);
  assert.equal(parsed?.publisher, "Tor");
  assert.equal(parsed?.publishedDate, "August 31st 2010");
});

test("parseGoogleBooksVolume usa o item com o ISBN exato", () => {
  const parsed = parseGoogleBooksVolume("9780765326355", {
    items: [
      {
        volumeInfo: {
          title: "Wrong Book",
          authors: ["Someone Else"],
          industryIdentifiers: [{ type: "ISBN_13", identifier: "9780000000000" }]
        }
      },
      {
        volumeInfo: {
          title: "The Way of Kings",
          subtitle: "Book One of the Stormlight Archive",
          authors: ["Brandon Sanderson"],
          publisher: "Tor Books",
          publishedDate: "2010",
          language: "en",
          industryIdentifiers: [{ type: "ISBN_13", identifier: "9780765326355" }]
        }
      }
    ]
  });
  assert.ok(parsed);
  assert.equal(parsed?.title, "The Way of Kings: Book One of the Stormlight Archive");
  assert.deepEqual(parsed?.authors, ["Brandon Sanderson"]);
  assert.equal(parsed?.publisher, "Tor Books");
});

test("publisherMatches tolera espaços, selos e rejeita editora diferente", () => {
  assert.equal(publisherMatches(["HarperVoyager"], "Harper Voyager"), true);
  assert.equal(publisherMatches(["HarperVoyager"], "HarperCollins"), true);
  assert.equal(publisherMatches(["Tor"], "Tor Books"), true);
  assert.equal(publisherMatches(["Tor"], "Del Rey"), false);
});

test("authorScore compara nomes e detecta outro alfabeto", () => {
  assert.equal(authorScore("Brandon Sanderson", ["Brandon Sanderson"]), 1);
  assert.equal(authorScore("Cixin Liu", ["刘慈欣"]), 0);
});

test("compareMetadata aceita a mesma edição", () => {
  const comparison = compareMetadata(
    wayOfKings,
    metadata({
      title: "The Way of Kings: Book One of the Stormlight Archive",
      authors: ["Brandon Sanderson"],
      publisher: "Tor"
    })
  );
  assert.equal(comparison.titleScore, 1);
  assert.equal(comparison.authorScore, 1);
  assert.equal(comparison.publisherMatch, true);
  assert.deepEqual(comparison.issues, []);
});

test("validateWork fica ok quando as duas fontes batem", () => {
  const ol = metadata({
    title: "The Way of Kings: Book One of the Stormlight Archive",
    authors: ["Brandon Sanderson"],
    publisher: "Tor"
  });
  const gb = metadata({
    source: "googlebooks",
    title: "The Way of Kings: Book One of the Stormlight Archive",
    authors: ["Brandon Sanderson"],
    publisher: "Tor Books",
    language: "en"
  });
  const item = validateWork(wayOfKings, source({ metadata: ol }), source({ metadata: gb }));
  assert.equal(item.status, "ok");
  assert.equal(item.title_score, 1);
  assert.equal(item.publisher_match, true);
  assert.deepEqual(item.issues, []);
});

test("validateWork marca livro errado como divergente", () => {
  const wrong = metadata({
    title: "The Hobbit",
    authors: ["J. R. R. Tolkien"],
    publisher: "Allen & Unwin"
  });
  const item = validateWork(wayOfKings, source({ metadata: wrong }), source({ found: false }));
  assert.equal(item.status, "divergent");
  assert.ok(item.issues.some((issue) => issue.startsWith("título:")));
  assert.ok(item.issues.some((issue) => issue.startsWith("autor:")));
});

test("validateWork marca editora diferente para revisão", () => {
  const wrongPublisher = metadata({
    title: "The Way of Kings",
    authors: ["Brandon Sanderson"],
    publisher: "Del Rey"
  });
  const item = validateWork(
    wayOfKings,
    source({ metadata: wrongPublisher }),
    source({ found: false })
  );
  assert.equal(item.status, "review");
  assert.equal(item.publisher_match, false);
  assert.ok(item.issues.some((issue) => issue.startsWith("editora:")));
});

test("validateWork marca Dune Messiah como revisão para o ISBN de Dune", () => {
  const messiah = metadata({
    title: "Dune Messiah",
    authors: ["Frank Herbert"],
    publisher: "Ace"
  });
  const item = validateWork(dune, source({ metadata: messiah }), source({ found: false }));
  assert.equal(item.status, "review");
  assert.equal(item.title_score, 0.5);
});

test("validateWork trata autor em outro alfabeto como revisão", () => {
  const darkForest = work({
    key: "the-dark-forest--cixin-liu",
    title: "The Dark Forest",
    author: "Cixin Liu",
    preferred_publishers: ["Tor", "Head of Zeus"],
    isbn13: "9781788543019"
  });
  const chinese = metadata({
    title: "The Dark Forest",
    authors: ["刘慈欣"],
    publisher: "Head of Zeus"
  });
  const item = validateWork(darkForest, source({ metadata: chinese }), source({ found: false }));
  assert.equal(item.status, "review");
  assert.ok(item.issues.some((issue) => issue.startsWith("autor em outro alfabeto")));
});

test("validateWork marca missing quando nenhuma fonte encontra o ISBN", () => {
  const item = validateWork(
    wayOfKings,
    source({ found: false, error: "ISBN não encontrado" }),
    source({ found: false, error: "HTTP 429" })
  );
  assert.equal(item.status, "missing");
  assert.equal(item.title_score, null);
  assert.ok(item.issues.some((issue) => issue.includes("Open Library")));
  assert.ok(item.issues.some((issue) => issue.includes("Google Books")));
});
