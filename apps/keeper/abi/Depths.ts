// Di-generate oleh `pnpm abi:sync`. Jangan edit manual.
export const depthsAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "initialOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "BASE_ATK",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "BASE_HP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "BLOCKHASH_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_AWARD_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_ENTRY_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_FLOOR",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_GAS_TOPUP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_ROUNDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_ENTRY_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PURPOSE_ENCOUNTER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PURPOSE_RESOLVE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "RAKE_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "act",
    "inputs": [
      {
        "name": "a",
        "type": "uint8",
        "internalType": "enum Action"
      },
      {
        "name": "swordQty",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "shieldQty",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "potionQty",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "usePotion",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cashOut",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "descend",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "enterDungeon",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "entryFee",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getBoards",
    "inputs": [],
    "outputs": [
      {
        "name": "cashouts",
        "type": "tuple[10]",
        "internalType": "struct BoardEntry[10]",
        "components": [
          {
            "name": "player",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "value",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "floor",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "runId",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "name": "depths",
        "type": "tuple[10]",
        "internalType": "struct BoardEntry[10]",
        "components": [
          {
            "name": "player",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "value",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "floor",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "runId",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRun",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "r",
        "type": "tuple",
        "internalType": "struct Run",
        "components": [
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "runId",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "floor",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "encounter",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "pendingAction",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "swords",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "shields",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "potions",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "usePotion",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "hp",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxHp",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "atk",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "monsterId",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "targetBlock",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "bag",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "encounterSeed",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "monsterStats",
    "inputs": [
      {
        "name": "floor",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "hp",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "atk",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "loot",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "nextRunId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "operatorOf",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pool",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolInfo",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewEncounter",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "enc",
        "type": "uint8",
        "internalType": "enum Encounter"
      },
      {
        "name": "monsterId",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "ready",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "expired",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewResolve",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "res",
        "type": "tuple",
        "internalType": "struct Resolution",
        "components": [
          {
            "name": "outcome",
            "type": "uint8",
            "internalType": "enum Outcome"
          },
          {
            "name": "survived",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "hpAfter",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "lootTable",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "bagLoss",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "name": "seed",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "ready",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "expired",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reapExpired",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reserved",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reveal",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "seedPool",
    "inputs": [],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "setEntryFee",
    "inputs": [
      {
        "name": "fee",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settle",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "stats",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "runs",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "bestFloor",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "totalCashedOut",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "totalLost",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "treasury",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawOperator",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawTreasury",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amt",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "ActionCommitted",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "runId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "floor",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "action",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum Action"
      },
      {
        "name": "usePotion",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "targetBlock",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CashedOut",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "runId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "floor",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "amount",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EncounterRevealed",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "runId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "floor",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "enc",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum Encounter"
      },
      {
        "name": "monsterId",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "seed",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EntryFeeSet",
    "inputs": [
      {
        "name": "entryFee",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FloorEntered",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "runId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "floor",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "targetBlock",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FloorResolved",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "runId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "floor",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "action",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum Action"
      },
      {
        "name": "resolveSeed",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "survived",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "hpAfter",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "bagDelta",
        "type": "int128",
        "indexed": false,
        "internalType": "int128"
      },
      {
        "name": "outcomeCode",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ItemsBought",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "runId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "swords",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "shields",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "potions",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "cost",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LootAwarded",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "runId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "amount",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "tableAmount",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PoolChanged",
    "inputs": [
      {
        "name": "pool",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "reserved",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RunDied",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "runId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "floor",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "lostBag",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "cause",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RunStarted",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "runId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "entryFee",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TreasuryWithdrawn",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BlockhashUnavailable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientBag",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientFee",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientTreasury",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAction",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidFee",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidFloor",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ItemLimit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MaxFloorReached",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPotion",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotRunController",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OperatorInUse",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeCastOverflowedUintDowncast",
    "inputs": [
      {
        "name": "bits",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "TooEarly",
    "inputs": [
      {
        "name": "targetBlock",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "current",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "TopUpTooLarge",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongState",
    "inputs": [
      {
        "name": "expected",
        "type": "uint8",
        "internalType": "enum RunState"
      },
      {
        "name": "actual",
        "type": "uint8",
        "internalType": "enum RunState"
      }
    ]
  }
] as const;
