# Net Worth Tracker — MVP Specification

## What Is It?

A personal web app to track your total financial wealth across different asset types and currencies. Instead of maintaining a monthly Excel spreadsheet, you open the app, enter your current balances, and instantly see your full financial picture converted into a single currency — with automatic comparison to last month and the beginning of the year.

The core idea is simple: you know what you own, but it’s scattered across cash in different currencies, investment funds, bonds, and crypto. This app brings it all together in one number, updated monthly, with a clear view of how that number is changing over time.

-----

## Who Is It For?

Anyone who manually tracks their personal finances in a spreadsheet and wants a cleaner, more visual way to do it — without connecting bank accounts or using complex financial tools.

-----

## Asset Categories

### 💳 Bank & Cash Accounts

|Category                  |Description                         |
|--------------------------|------------------------------------|
|**Checking Account**      |Everyday spending account           |
|**Savings Account**       |Deposits, high-yield savings        |
|**Business / FOP Account**|Sole proprietor or corporate account|
|**Cash on Hand**          |Physical cash in any currency       |

### 📈 Investments

|Category            |Description                                             |
|--------------------|--------------------------------------------------------|
|**Stocks**          |Individual equity holdings                              |
|**Investment Funds**|ETFs, mutual funds, index funds                         |
|**Bonds**           |Government (e.g. war bonds, T-bills) and corporate bonds|
|**Crypto**          |Bitcoin, Ethereum, altcoins                             |

### 🏦 Hard Assets *(optional but recommended)*

|Category                |Description                                 |
|------------------------|--------------------------------------------|
|**Precious Metals**     |Gold, silver — physical or ETF              |
|**Real Estate**         |Estimated market value of owned property    |
|**Vehicles & Valuables**|Cars, equipment — if you want a full picture|

### 📤 Liabilities *(critical for true net worth)*

|Category             |Description                                            |
|---------------------|-------------------------------------------------------|
|**Loans & Credit**   |Mortgage, car loan, personal loan — tracked as negative|
|**P2P / Loans Given**|Money others owe you — tracked as positive             |


> **Note:** Net Worth = Total Assets − Total Liabilities. Without liabilities, you’re only tracking gross assets, not true net worth.

-----

## MVP Features

### Core Functionality

- **Manual asset input** — enter balances across all categories listed above
- **Multi-currency support** — PLN, USD, EUR with live exchange rate conversion
- **Crypto live pricing** — auto-fetch current prices for BTC, ETH, and others
- **Total net worth** — one clear number: assets minus liabilities
- **Monthly snapshot** — the app automatically saves your data once a month so history is preserved
- **Delta indicators** — see how your net worth changed vs. last month and vs. January 1st
- **Historical chart** — a line graph showing wealth over time across all saved snapshots

### What Is NOT in the MVP

- Bank/broker integrations — all input is manual
- Multiple user accounts or sharing
- Budgeting or expense tracking
- Goal setting
- Push notifications or reminders
- Currency display switcher (fixed to one display currency)
- PDF or CSV export
- Inflation-adjusted calculations
- Mobile app

-----

## Nice to Have — FIRE Calculator

A dedicated section for users working toward **Financial Independence, Retire Early (FIRE)**.

### How It Works

The user inputs a few parameters and the calculator shows how close they are to financial independence.

#### Inputs

|Field                   |Description                                           |Example|
|------------------------|------------------------------------------------------|-------|
|**Monthly expenses**    |Current or projected monthly spending after retirement|$2,000 |
|**Annual return rate**  |Expected investment portfolio return                  |7%     |
|**Safe withdrawal rate**|% of portfolio withdrawn per year (default: 4%)       |4%     |
|**Annual savings**      |How much you save/invest per year                     |$12,000|

#### Outputs

**FIRE Number** — the portfolio size needed to retire:

```
FIRE Number = Annual Expenses / Safe Withdrawal Rate
Example: ($2,000 × 12) / 0.04 = $600,000
```

**Progress Bar** — visually shows how close your current net worth is to your FIRE number:

```
[████████░░░░░░░░░░░░] 42% — $252,000 of $600,000
```

**Years to FIRE** — estimated time to reach the FIRE number at the current savings rate:

```
Estimated: ~14 years at $12,000/year saved + 7% annual growth
```

**FIRE Variants** *(optional tabs)*

|Variant         |Description                                |
|----------------|-------------------------------------------|
|**Lean FIRE**   |Minimal lifestyle, lower expense target    |
|**Regular FIRE**|Standard retirement lifestyle              |
|**Fat FIRE**    |Comfortable/luxury lifestyle, higher target|

### Display Components

- **Progress bar** with percentage label and current vs. target values
- **Projected timeline chart** — net worth growth curve to FIRE number
- **Key metrics panel** — FIRE number, years to goal, monthly savings needed to hit goal faster
- Auto-syncs with current net worth from the tracker (no double entry)

-----