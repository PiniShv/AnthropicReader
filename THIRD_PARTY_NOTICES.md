# Third-party notices

Claude Export Reader includes two third-party libraries. They are kept as unmodified, minified files in [`vendor/`](vendor/). The build copies both of them into `dist/claude-export-reader.html`, so the built file contains them too. Each file keeps its original license header.

They are vendored (not loaded from a CDN) because the reader must work offline and must not load code from the network.

| Library | Version | File | Official file (npm package / path) | License |
|---|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 18.1.0 | `vendor/marked.min.js` | `marked@18.1.0/lib/marked.umd.js` | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | `vendor/purify.min.js` | `dompurify@3.4.16/dist/purify.min.js` | Apache-2.0 OR MPL-2.0 |

What they do in the reader:

- **marked** turns Markdown from the export (messages, project docs, memory, comments) into HTML.
- **DOMPurify** cleans that HTML before it is shown, so content from the export cannot run scripts in the reader.

## Checksums

Each file in `vendor/` is byte for byte the official file from its npm package, and the package matches the `integrity` value of the npm registry. These are the SHA-256 checksums of the files:

```text
f424dcb508fdf93e0137a970cfce8f3207ea2e3f37eca5f7556a52875683632a  vendor/marked.min.js
2c90a9b46d6463f26038a29b686e82bc91de01fdac9d5229e7cfe3b360134ea2  vendor/purify.min.js
```

- `npm test` fails when a file in `vendor/` does not match its checksum here, or when this page names a different version than the file. So an edited or swapped file cannot slip in unnoticed.
- `node scripts/check-vendor.mjs` downloads the packages from npm and checks everything again. It also lists known security advisories and newer releases. It needs the network. A weekly workflow ([vendor-check.yml](.github/workflows/vendor-check.yml)) runs it too, so a new advisory shows up as a failed run.
- To update a library, see [Updating a vendored library](CONTRIBUTING.md#updating-a-vendored-library).

---

## marked 18.1.0

Copyright (c) 2018+, MarkedJS, and (c) 2011-2018, Christopher Jeffrey.
Source: <https://github.com/markedjs/marked/tree/v18.1.0>

This project redistributes the official minified browser build (`lib/marked.umd.js` from the `marked@18.1.0` npm package) without changes, under the name `vendor/marked.min.js`. The license below is copied from marked's [`LICENSE`](https://github.com/markedjs/marked/blob/v18.1.0/LICENSE).

```text
## Marked

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Markdown

Copyright © 2004, John Gruber
http://daringfireball.net/
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
* Neither the name “Markdown” nor the names of its contributors may be used to
  endorse or promote products derived from this software without specific
  prior written permission.

This software is provided by the copyright holders and contributors “as is”
and any express or implied warranties, including, but not limited to, the
implied warranties of merchantability and fitness for a particular purpose are
disclaimed. In no event shall the copyright owner or contributors be liable for
any direct, indirect, incidental, special, exemplary, or consequential damages
(including, but not limited to, procurement of substitute goods or services;
loss of use, data, or profits; or business interruption) however caused and on
any theory of liability, whether in contract, strict liability, or tort
(including negligence or otherwise) arising in any way out of the use of this
software, even if advised of the possibility of such damage.
```

## DOMPurify 3.4.16

Copyright (c) Cure53 and other contributors (Dr.-Ing. Mario Heiderich, Cure53).
Source: <https://github.com/cure53/DOMPurify/tree/3.4.16>

DOMPurify is free software. You may redistribute and/or modify it under the terms of **either**:

- a) the Apache License, Version 2.0: <https://www.apache.org/licenses/LICENSE-2.0>, or
- b) the Mozilla Public License, Version 2.0: <https://www.mozilla.org/MPL/2.0/>

The full text of both licenses, as shipped with this version, is in DOMPurify's [`LICENSE`](https://github.com/cure53/DOMPurify/blob/3.4.16/LICENSE) (Apache-2.0) and [`LICENSE-MPL`](https://github.com/cure53/DOMPurify/blob/3.4.16/LICENSE-MPL) (MPL-2.0) files.

This project redistributes the official minified build (`dist/purify.min.js` from the `dompurify@3.4.16` npm package) without changes. Its source code is available at the link above.
