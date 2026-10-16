// -----------------------------------------------------------------------------
// SIA DC-09 lines, unchanged, from pysiaalarm's tests
// (https://github.com/eavanvalkenburg/pysiaalarm, commit c445c15, MIT, see
// THIRD_PARTY_NOTICES.md): tests/test_sia_package_cases.py (EventParsing) and
// tests/run_re.py (samples from real panels). `crc` says whether the CRC of
// the line is right: pysiaalarm's parsing tests do not check it, so several
// are not. Their length field is often wrong too (pysiaalarm's test encoder
// writes it oddly): the receiver does not rely on it.
// -----------------------------------------------------------------------------

/** pysiaalarm tests/test_utils.py: KEY and ACCOUNT of its encrypted tests. */
export const PYSIA_KEY = 'AAAAAAAAAAAAAAAA';

export const LINES = {
  // case_bug (#11): no `/` between ri and the code, a `^text^`.
  bug: {
    line: '9618004D"SIA-DCS"7960L0#123456[#123456|Nri1CL0^VX FRONTE ^]_22:40:48,04-11-2021',
    crc: false,
  },
  // case_bug2 (SIA #42).
  bug2: {
    line: '5670004D"SIA-DCS"8070L0#123456[#123456|Nri0KR1^TAST. 001 ^]_13:49:12,04-13-2021',
    crc: false,
  },
  admCid: {
    line: '87CD0037"ADM-CID"9876R579BDFL789ABC#12345A[#12345A|1110 00 129]_14:12:04,09-25-2011',
    crc: false,
  },
  admCid2: { line: '57150047"ADM-CID"0247R4F39L4F39#4F39[#4F39|3401 01 057]', crc: true },
  codeJc: { line: '97F90078"SIA-DCS"6002L0#AAA[|Nri2/JC12]_12:58:23,09-15-2021', crc: true },
  xdataM: {
    line: '87570078"SIA-DCS"6002L0#AAA[|Nri1/CL501][M0026B9E4268B]_14:12:04,09-25-2019',
    crc: true,
  },
  xdataK: {
    line: '02310052"SIA-DCS"6002L0#1111[|Nri1/RP000][KAAAAAAAAAAAAAAAA]_14:12:04,09-25-2019',
    crc: true,
  },
  xdataXY: {
    line: '5B090059"SIA-DCS"0004L0#1111[#1111|Nri1/PA501][X006E07.7777777][Y49N06.6666666]_20:45:46,04-22-2021',
    crc: true,
  },
  // case_encrypted: not encrypted with PYSIA_KEY (another key): a wrong key for us.
  encrypted: {
    line: '60AB0078"*SIA-DCS"5994L0#AAA[5AB718E008C616BF16F6468033A11326B0F7546CAB230910BCA10E4DEBA42283C436E4F8EFF50931070DDE36D5BB5F0C',
    crc: true,
  },
  cl: { line: 'E5D50078"SIA-DCS"6002L0#AAA[|Nri1/CL501]_14:12:04,09-25-2019', crc: true },
  // run_re.py: the same message with another CRC.
  clBadCrc: { line: '2E680078"SIA-DCS"6002L0#AAA[|Nri1/CL501]_14:12:04,09-25-2019', crc: false },
  op: { line: '90820051"SIA-DCS"4738R0001L0001[#006969|Nri04/OP001NM]', crc: false },
  // case_null: encrypted with PYSIA_KEY, a pad of `p` and no `|`: `ppppppppppp]_18:24:52,07-05-2020`.
  nullEncrypted: {
    line: '76D80055"*NULL"0000R0L0#AAAB[B4BC8B40D0E6D959D6BEA78E88CC0B2155741A3C44FBB96D476A3E557CAD64D9',
    crc: true,
  },
  wa: { line: 'C4160279"SIA-DCS"5268L0#AAA[Nri1/WA000]_08:40:47,07-08-2020', crc: false },
  // run_re.py
  rpNoNumber: { line: '1908002B"SIA-DCS"0000L0#3080[#3080|Nti19:44/id1/ri4/RP]', crc: false },
  xc: { line: '43580023"SIA-DCS"0084L0#AAA[#AAA|Nri1/XC12]', crc: true },
  formatError: { line: 'this is not a parsable event', crc: false },
};

/** Decrypted data blocks of real Ajax hubs (run_re.py, account EA1984; key unknown). */
export const AJAX_DECRYPTED = [
  'v V|#EA1984|Nri0/RP0000]_16:57:20,08-11-2020',
  'P$WwA!#|#EA1984|Nri1/NL4]_08:38:13,01-07-2021',
];
