# Third-party notices

Claude Export Reader includes two third-party libraries. They are kept as unmodified, minified files in [`vendor/`](vendor/). The build copies both of them into `dist/claude-export-reader.html`, so the built file contains them too. Each file keeps its original license header.

They are vendored (not loaded from a CDN) because the reader must work offline and must not load code from the network.

| Library | Version | File | License |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 15.0.12 | `vendor/marked.min.js` | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.2.6 | `vendor/purify.min.js` | Apache-2.0 OR MPL-2.0 |

What they do in the reader:

- **marked** turns Markdown from the export (messages, project docs, memory, comments) into HTML.
- **DOMPurify** cleans that HTML before it is shown, so content from the export cannot run scripts in the reader.

---

## marked 15.0.12

Copyright (c) Christopher Jeffrey and the marked contributors.
Source: <https://github.com/markedjs/marked/tree/v15.0.12>

This project redistributes the official minified build (`marked.min.js` from the `marked@15.0.12` npm package) without changes. The license below is copied from marked's [`LICENSE.md`](https://github.com/markedjs/marked/blob/v15.0.12/LICENSE.md).

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

## DOMPurify 3.2.6

Copyright (c) Cure53 and other contributors (Dr.-Ing. Mario Heiderich, Cure53).
Source: <https://github.com/cure53/DOMPurify/tree/3.2.6>

DOMPurify is free software. You may redistribute and/or modify it under the terms of **either**:

- a) the Apache License, Version 2.0: <https://www.apache.org/licenses/LICENSE-2.0>, or
- b) the Mozilla Public License, Version 2.0: <https://www.mozilla.org/MPL/2.0/>

The full text of both licenses, as shipped with this version, is in DOMPurify's [`LICENSE`](https://github.com/cure53/DOMPurify/blob/3.2.6/LICENSE) file.

This project redistributes the official minified build (`dist/purify.min.js` from the `dompurify@3.2.6` npm package) without changes. Its source code is available at the link above.
