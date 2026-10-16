# Third-party notices

This integration contains material derived from the following projects, used
under the MIT licence.

## pysiaalarm

https://github.com/eavanvalkenburg/pysiaalarm — commit c445c15 (2026-01-28).

Used in: `src/sia/codes.js` (the SIA event code table and the ADM-CID to SIA
mapping, generated from `src/pysiaalarm/data/sia_codes.py` and
`adm_mapping.py`), `test/fixtures/frames.js` (SIA DC-09 lines of its tests),
`test/helpers/siaClient.js` (transcription of its test encoder). It is also
the protocol reference of `src/sia/` (CRC, encryption, replies).

```
The MIT License (MIT)

Copyright (c) 2021 E.A. van Valkenburg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## homebridge-ajax-sia

https://github.com/MoustacheOff/homebridge-ajax-sia — version 1.1.2
(2026-10-12).

Used in: `src/sia/frame.js` and `src/sia/receiver.js` (the frame pattern,
CRC-16/ARC, AES-CBC handling and reply forms, ported from its
`src/sia/frame.ts` and `src/sia/receiver.ts`), `src/sia/server.js` (the
TCP / UDP listener structure of its `src/sia/server.ts`) and `src/model.js`
(the arming and alarm rules of its `src/ajax/model.ts`, measured on a real
Ajax Hub 2).

```
MIT License

Copyright (c) 2026 Gabriel Corral

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
