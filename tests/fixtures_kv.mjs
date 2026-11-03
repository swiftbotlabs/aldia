// Snapshot of the public records the live Worker served on 2026-11-03 (GET /api/stats, /api/lease/<id>, /api/recibo/<id>/2026-11). Test data for the server-rendered pages.
// Generated from the live JSON; every 64-hex value is a public Celo transaction or receipt hash.
export default {
 "stats": {
  "leasesThird": 0,
  "leasesTest": 5,
  "paymentsThird": 0,
  "paymentsTest": 4,
  "leases": [
   {
    "label": "Prueba: depto demo Swift Bot Labs",
    "kind": "prueba nuestra"
   },
   {
    "label": "Prueba: contrato de febrero con IPC trimestral",
    "kind": "prueba nuestra"
   },
   {
    "label": "Prueba: contrato de febrero con ICL",
    "kind": "prueba nuestra"
   },
   {
    "label": "Prueba: contrato leído de un PDF",
    "kind": "prueba nuestra"
   },
   {
    "label": "Prueba: fábrica nueva, piso de dos ventanas",
    "kind": "prueba nuestra"
   }
  ],
  "paidCalls": {
   "count": 8,
   "usd": 0.063848,
   "recent": [
    {
     "service": "Lectura y revisión de contrato (modelo de Cencori, vía buy)",
     "usd": 0.01,
     "tx": "0x17686c51aa495af6e372713368fe422b3b405f552a62a78760ad41a70d049747" // public tx
    },
    {
     "service": "Navegador alquilado (prueba, vía buy)",
     "usd": 0.004212,
     "tx": "0x59a5b64a1ef6353c008579c3bcf2b18cc43821ff2025a629b0a1ff103df7faf7" // public tx
    },
    {
     "service": "Navegador alquilado (prueba, vía buy)",
     "usd": 0.004818,
     "tx": "0x265f7af52a4038eff0ed9d1e5448aefee9e5bf32027f18ada11f705a86781527" // public tx
    },
    {
     "service": "Navegador alquilado (prueba, vía buy)",
     "usd": 0.004818,
     "tx": "0x94dced91c648a6d97db8fb24077993c27c2b26cf66670b999cd754111bf5961a" // public tx
    },
    {
     "service": "Lectura y revisión de contrato (modelo de Cencori, vía buy)",
     "usd": 0.01,
     "tx": "0xc385e6e5b61188cbc527f317940a5e0ed13946e4dfcea811b4af8df2f22756f0" // public tx
    },
    {
     "service": "Lectura y revisión de contrato (modelo de Cencori, vía buy)",
     "usd": 0.01,
     "tx": "0x05ea6681bd88ec4521384dfb56f70fb5518e564f7af7e7f81b11c80b81849a77" // public tx
    },
    {
     "service": "Lectura y revisión de contrato (modelo de Cencori, vía buy)",
     "usd": 0.01,
     "tx": "0x0b2064e6a170a52600afd8d0c743d1e70f428f04f09b0f67fceefbff24491a96" // public tx
    },
    {
     "service": "Lectura y revisión de contrato (modelo de Cencori, vía buy)",
     "usd": 0.01,
     "tx": "0x98f2e2703233387c66c3712dafad46fe673dd802185b58b30e0fad310ac402be" // public tx
    }
   ]
  },
  "updatedAt": "2026-11-01 19:09 UTC"
 },
 "receipt:3c9a8784b63e:2026-11": {
  "lease": "3c9a8784b63e",
  "month": "2026-11",
  "amount": 4000,
  "received": 4000,
  "paymentTxs": [],
  "detail": {
   "month": "2026-11",
   "adjustmentMonth": "2026-11",
   "adjustments": 0,
   "index": "IPC",
   "baseRent": 4000,
   "amount": 4000,
   "factor": "1",
   "pct": 0
  },
  "builderTest": true,
  "propertyLabel": "Prueba: depto demo Swift Bot Labs",
  "index": "IPC",
  "paidAt": "2026-11-01T12:46:06Z",
  "settleTx": "0x947955cd7b31aad7c2d64e1df1648c0ecb53c6046ed92c3bf0e2db300a0cd341", // public tx
  "receiptHash": "0xff949da2cb73a1be48cc9451f34ec440e60212baf63cbc602aed482c2f2e7587", // public receipt hash
  "fee": 12,
  "pesoToLandlord": 1994,
  "dollarToLandlord": 1.211875,
  "route": "Uniswap",
  "rate": 1645.38,
  "execution": {
   "floor": 1200598,
   "uniswap": 1211875,
   "textilePreview": 1211158
  },
  "paymentTxsLate": [
   "0x438b11f40a7303ac05a6710c2005ed07c2c431ea425fcfd5f1c1ab1d5932d4af" // public tx
  ]
 },
 "pub:3c9a8784b63e": {
  "id": "3c9a8784b63e",
  "propertyLabel": "Prueba: depto demo Swift Bot Labs",
  "collector": "0x7F7A423211Fb875Fd62f7b53A79F6c656A6E5D96",
  "deployed": true,
  "builderTest": true,
  "index": "IPC",
  "periodMonths": 3,
  "sweepBps": 0,
  "closed": false,
  "feeBps": 30,
  "nextAdjustment": "2027-02",
  "updatedAt": "2026-11-03T07:15:06Z",
  "current": {
   "month": "2026-11",
   "amount": 4000,
   "dueDate": "2026-11-10",
   "status": "pagado",
   "received": 4000,
   "detail": {
    "month": "2026-11",
    "adjustmentMonth": "2026-11",
    "adjustments": 0,
    "index": "IPC",
    "baseRent": 4000,
    "amount": 4000,
    "factor": "1",
    "pct": 0
   },
   "clauseCheck": null
  },
  "history": [
   {
    "month": "2026-11",
    "amount": 4000,
    "status": "pagado"
   }
  ]
 },
 "receipt:74414e7210ef:2026-11": {
  "lease": "74414e7210ef",
  "month": "2026-11",
  "amount": 2102,
  "received": 2102,
  "paymentTxs": [
   "0xe6de665bcfcaf4af4ec24175a2f1f636f7779562087f48c5a5e08028d01137db" // public tx
  ],
  "detail": {
   "month": "2026-11",
   "adjustmentMonth": "2026-11",
   "adjustments": 3,
   "index": "IPC",
   "baseRent": 1700,
   "refFrom": "2025-12",
   "refTo": "2026-09",
   "monthsUsed": [
    "2026-07",
    "2026-08",
    "2026-09"
   ],
   "levelFrom": 10121.3715,
   "levelTo": 12514.1508,
   "stepPct": 5.82,
   "amount": 2102,
   "factor": "1.236409",
   "pct": 23.64
  },
  "builderTest": true,
  "propertyLabel": "Prueba: contrato de febrero con IPC trimestral",
  "index": "IPC",
  "paidAt": "2026-11-01T12:59:26Z",
  "settleTx": "0xf24844e388a5955fc860d16d2d9ba8ab5d89da3d62cfc91dbc873e31e15dec80", // public tx
  "receiptHash": "0x02770b0cd7b67cf78b4f9a2d746c46d6e0ca7577ca186f5be913458651855bc0", // public receipt hash
  "fee": 6,
  "pesoToLandlord": 0,
  "dollarToLandlord": 1.272861,
  "route": "Uniswap",
  "rate": 1646.44,
  "execution": {
   "floor": 1261324,
   "uniswap": 1272861,
   "textilePreview": 1273034,
   "textileFirm": {
    "ok": false,
    "buyAmount": null,
    "reason": "Your wallet does not hold enough of the sell token to settle this trade",
    "rfqId": null
   }
  }
 },
 "pub:74414e7210ef": {
  "id": "74414e7210ef",
  "propertyLabel": "Prueba: contrato de febrero con IPC trimestral",
  "collector": "0x44e45C08C7A488eAec103293D20a279439b12D09",
  "deployed": true,
  "builderTest": true,
  "index": "IPC",
  "periodMonths": 3,
  "sweepBps": 10000,
  "closed": false,
  "feeBps": 30,
  "nextAdjustment": "2027-02",
  "updatedAt": "2026-11-03T07:15:06Z",
  "current": {
   "month": "2026-11",
   "amount": 2102,
   "dueDate": "2026-11-10",
   "status": "pagado",
   "received": 2102,
   "detail": {
    "month": "2026-11",
    "adjustmentMonth": "2026-11",
    "adjustments": 3,
    "index": "IPC",
    "baseRent": 1700,
    "refFrom": "2025-12",
    "refTo": "2026-09",
    "monthsUsed": [
     "2026-07",
     "2026-08",
     "2026-09"
    ],
    "levelFrom": 10121.3715,
    "levelTo": 12514.1508,
    "stepPct": 5.82,
    "amount": 2102,
    "factor": "1.236409",
    "pct": 23.64
   },
   "clauseCheck": null
  },
  "history": [
   {
    "month": "2026-11",
    "amount": 2102,
    "status": "pagado"
   }
  ]
 },
 "receipt:8650326827d3:2026-11": {
  "lease": "8650326827d3",
  "month": "2026-11",
  "amount": 1859,
  "received": 1859,
  "paymentTxs": [
   "0xa363761b8edde783e07770829a6758f105d63594ede8d42951966148a5bb56c6" // public tx
  ],
  "detail": {
   "month": "2026-11",
   "adjustmentMonth": "2026-11",
   "adjustments": 3,
   "index": "ICL",
   "baseRent": 1500,
   "refFrom": "2026-02-01",
   "refTo": "2026-11-01",
   "levelFrom": 30.03,
   "levelTo": 37.21,
   "stepPct": 6.28,
   "amount": 1859,
   "factor": "1.239094",
   "pct": 23.91
  },
  "builderTest": true,
  "propertyLabel": "Prueba: contrato de febrero con ICL",
  "index": "ICL",
  "paidAt": "2026-11-01T13:05:54Z",
  "settleTx": "0x59a313d4c5e265d402189ea46cdd41e3ac362033da57fc00df88bfd62bded6e6", // public tx
  "receiptHash": "0x81cee38e5e0f53bd2375e7dc42c64492a1cc28a65a03ad5f8bf9d0aae9be8d0d", // public receipt hash
  "fee": 5,
  "pesoToLandlord": 0,
  "dollarToLandlord": 1.124876,
  "route": "Textile FX",
  "rate": 1647.67,
  "execution": {
   "floor": 1114951,
   "uniswap": 1125160,
   "textilePreview": 1124787,
   "textileFirm": {
    "ok": true,
    "buyAmount": 1124876,
    "reason": null,
    "rfqId": "rfq_9DrkxXI0Zomx_17B"
   }
  }
 },
 "pub:8650326827d3": {
  "id": "8650326827d3",
  "propertyLabel": "Prueba: contrato de febrero con ICL",
  "collector": "0x5372c6A1Df42340ba4ACaE73b738A5dd70892322",
  "deployed": true,
  "builderTest": true,
  "index": "ICL",
  "periodMonths": 3,
  "sweepBps": 10000,
  "closed": false,
  "feeBps": 30,
  "nextAdjustment": "2027-02",
  "updatedAt": "2026-11-03T07:15:06Z",
  "current": {
   "month": "2026-11",
   "amount": 1859,
   "dueDate": "2026-11-10",
   "status": "pagado",
   "received": 1859,
   "detail": {
    "month": "2026-11",
    "adjustmentMonth": "2026-11",
    "adjustments": 3,
    "index": "ICL",
    "baseRent": 1500,
    "refFrom": "2026-02-01",
    "refTo": "2026-11-01",
    "levelFrom": 30.03,
    "levelTo": 37.21,
    "stepPct": 6.28,
    "amount": 1859,
    "factor": "1.239094",
    "pct": 23.91
   },
   "clauseCheck": null
  },
  "history": [
   {
    "month": "2026-11",
    "amount": 1859,
    "status": "pagado"
   }
  ]
 },
 "receipt:0b069750a07b:2026-11": {
  "lease": "0b069750a07b",
  "month": "2026-11",
  "amount": 1000,
  "received": 1000,
  "paymentTxs": [
   "0x786a56c5ad24247919cc1ec80c1f5064513dba80cb1b0192b9992c7c3af543a0" // public tx
  ],
  "detail": {
   "month": "2026-11",
   "adjustmentMonth": "2026-11",
   "adjustments": 0,
   "index": "IPC",
   "baseRent": 1000,
   "amount": 1000,
   "factor": "1",
   "pct": 0
  },
  "builderTest": true,
  "propertyLabel": "Prueba: fábrica nueva, piso de dos ventanas",
  "index": "IPC",
  "paidAt": "2026-11-01T13:58:02Z",
  "settleTx": "0x502f68f20c46b3c3ba3d013490dab9b4893a61713940157188d92c3ed704ac04", // public tx
  "receiptHash": "0xb1253c0de45db7dd9370275519438a4c1a25a930ac1163bff29f1472072f6506", // public receipt hash
  "fee": 3,
  "pesoToLandlord": 498,
  "dollarToLandlord": 0.302886,
  "route": "Uniswap",
  "rate": 1645.83,
  "execution": {
   "floor": 300239,
   "uniswap": 302886,
   "textilePreview": 303155,
   "textileFirm": {
    "ok": false,
    "buyAmount": null,
    "reason": "sellAmount is below the RFQ minimum (1644930000000000000000 atomic units)",
    "rfqId": null
   }
  }
 },
 "pub:0b069750a07b": {
  "id": "0b069750a07b",
  "propertyLabel": "Prueba: fábrica nueva, piso de dos ventanas",
  "collector": "0xE818f3901FfE0E7a576f0BA4577F95BFD0821676",
  "deployed": true,
  "builderTest": true,
  "index": "IPC",
  "periodMonths": 3,
  "sweepBps": 5000,
  "closed": false,
  "feeBps": 30,
  "nextAdjustment": "2027-02",
  "updatedAt": "2026-11-03T07:15:06Z",
  "current": {
   "month": "2026-11",
   "amount": 1000,
   "dueDate": "2026-11-10",
   "status": "pagado",
   "received": 1000,
   "detail": {
    "month": "2026-11",
    "adjustmentMonth": "2026-11",
    "adjustments": 0,
    "index": "IPC",
    "baseRent": 1000,
    "amount": 1000,
    "factor": "1",
    "pct": 0
   },
   "clauseCheck": null
  },
  "history": [
   {
    "month": "2026-11",
    "amount": 1000,
    "status": "pagado"
   }
  ]
 },
 "pub:c658d0b11729": {
  "id": "c658d0b11729",
  "propertyLabel": "Prueba: contrato leído de un PDF",
  "collector": "0x705FD68127133EA777b283fe04E9137782B7C11e",
  "deployed": false,
  "builderTest": true,
  "index": "IPC",
  "periodMonths": 4,
  "sweepBps": 5000,
  "closed": false,
  "feeBps": 30,
  "nextAdjustment": "2027-03",
  "updatedAt": "2026-11-03T07:15:06Z",
  "current": {
   "month": "2026-11",
   "amount": 660978,
   "dueDate": "2026-11-10",
   "status": "pendiente",
   "received": 0,
   "detail": {
    "month": "2026-11",
    "adjustmentMonth": "2026-11",
    "adjustments": 2,
    "index": "IPC",
    "baseRent": 550000,
    "refFrom": "2026-01",
    "refTo": "2026-09",
    "monthsUsed": [
     "2026-06",
     "2026-07",
     "2026-08",
     "2026-09"
    ],
    "levelFrom": 10413.0309,
    "levelTo": 12514.1508,
    "stepPct": 7.81,
    "amount": 660978,
    "factor": "1.201778",
    "pct": 20.18
   },
   "clauseCheck": {
    "ok": true,
    "note": "Coincide: usa IPC nivel general del INDEC, cada 4 meses y acumula los 4 meses indicados.",
    "tx": "0x98f2e2703233387c66c3712dafad46fe673dd802185b58b30e0fad310ac402be" // public tx
   }
  },
  "history": [
   {
    "month": "2026-11",
    "amount": 660978,
    "status": "pendiente"
   }
  ]
 }
};
