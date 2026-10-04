/**
 * Pilot Help & FAQ content (#129). Kept separate from the page so maintainers
 * can review and edit the copy without touching layout code.
 */

export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@amana.example";

export interface FaqItem {
  id: string;
  question: string;
  answer: string[];
}

export interface FaqSection {
  id: string;
  title: string;
  items: FaqItem[];
}

export const FAQ_SECTIONS: FaqSection[] = [
  {
    id: "basics",
    title: "The basics",
    items: [
      {
        id: "what-is-amana",
        question: "What does Amana do?",
        answer: [
          "Amana holds the buyer's payment in a smart contract on the Stellar network until the goods arrive. Neither side can take the money alone: it is released to the seller when the buyer confirms delivery, or split by a mediator if there is a dispute.",
        ],
      },
      {
        id: "what-is-cngn",
        question: "What is cNGN?",
        answer: [
          "cNGN is a stablecoin that tracks the Nigerian naira one-to-one. Trades settle in cNGN so both parties see amounts in naira terms, without exposure to crypto price swings.",
          "When a buyer pays in another asset (such as USDC), it is converted to cNGN through a Stellar path payment before the funds are locked.",
        ],
      },
      {
        id: "pilot-limit",
        question: "Is there a limit on how much I can trade?",
        answer: [
          "Yes. During the pilot each trade has a maximum amount to limit risk while we learn. If you enter more than the limit, the app tells you the maximum you can use. Split larger orders into several trades.",
        ],
      },
    ],
  },
  {
    id: "fees",
    title: "Fees",
    items: [
      {
        id: "platform-fee",
        question: "What fees do I pay?",
        answer: [
          "A small platform fee is taken from the trade amount when funds are released. It is set in the escrow contract and can never be more than 5% of the trade.",
          "Stellar also charges a network fee for each transaction you sign. It is a fraction of a cent and is paid from your wallet's XLM balance.",
        ],
      },
      {
        id: "fee-on-dispute",
        question: "Do I still pay a fee if there is a dispute?",
        answer: [
          "The platform fee is applied when the escrow is settled, whether the funds go to one party or are split after a dispute.",
        ],
      },
    ],
  },
  {
    id: "disputes",
    title: "Disputes",
    items: [
      {
        id: "raise-dispute",
        question: "What if the goods arrive damaged or short?",
        answer: [
          "Before confirming delivery, open the trade and choose Raise dispute. Upload a video showing the problem, including the driver acknowledging the condition of the goods where possible.",
          "Do not confirm delivery if something is wrong: confirming releases the funds to the seller.",
        ],
      },
      {
        id: "who-decides",
        question: "Who decides a dispute, and how is the money split?",
        answer: [
          "An independent mediator reviews the evidence from both sides. They either release all funds to one party or split them using the loss ratio you both agreed when the trade was created.",
        ],
      },
      {
        id: "funds-safe",
        question: "Are my funds safe while a dispute is open?",
        answer: [
          "Yes. The funds stay locked in the escrow contract until the dispute is resolved. Nobody, including the Amana team, can move them to anyone other than the buyer or seller.",
        ],
      },
    ],
  },
  {
    id: "account",
    title: "Wallet and account",
    items: [
      {
        id: "wallet",
        question: "Which wallet do I need?",
        answer: [
          "On the web, use the Freighter browser extension. On mobile, connect your Stellar wallet from the Connect screen. Keep your recovery phrase private: Amana will never ask for it.",
        ],
      },
    ],
  },
];
