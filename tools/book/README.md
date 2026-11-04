# Book compile tools

Rebuild the compiled rulebook PDFs from the second draft chapter files.

- compile.py: chapters to PDF with book page numbers, odd-page chapter starts,
  Table of Contents and In This Chapter numbers, bookmarks, links, and the Lulu
  print interior (light maps only, 8.75 x 11.25 in with bleed). Reuses the cover,
  title page, Foreword, Introduction, and back matter from the last compiled books.
- cover.py: widens or narrows the Lulu cover spine for a new page count
  (spine inches = pages / 444 + 0.06).

Needs LibreOffice, Carlito, and Gelasio installed under the name Georgia so page
breaks match Word.
