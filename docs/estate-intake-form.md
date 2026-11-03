# Estate Plan Organizer — Client Intake Form

This is the question-by-question content of the client intake questionnaire (the estate-planning track), as it appears in the portal. It covers every section, question and answer choice, and the conditions that show or hide each one.

Source of truth: `lib/intake/legacySections.ts` (section order and conditions), `components/intake/*` (questions), and `packages/estate-fields/src/core/*` (choice lists). The schema-driven definition in `lib/intake/forms/definitions/estate.ts` has the same sections and questions. The separate College Prep track (`intake_track = college_prep`) is not covered here.

**Legend**
- *(optional)*: shown as optional on the form
- **Shown only if …**: the question or section appears only when that condition is met
- Text fields with no fixed choices are marked *free text*, *date*, *email* or *phone*

---

## Section 1 — Getting Started *(optional)*
*How did you find us?* · ~1 min

1. **How did you hear about us?** *(optional)*
   - Referral
   - Legal Insurance
   - Other

2. **Legal Insurance Plan**: **shown only if** "Legal Insurance" is selected
   - MetLife
   - LegalEase
   - ARAG
   - CLC

3. **Member ID / Case Number**: *free text*. **Shown only if** "Legal Insurance" is selected

4. **Who referred you? We'd love to thank them!**: *free text*. **Shown only if** "Referral" is selected

---

## Section 2 — Personal Information
*Name, contact & address* · ~5 min

| # | Question | Type / Choices |
|---|---|---|
| 1 | First Name | *free text* (required) |
| 2 | Middle Name | *free text* |
| 3 | Last Name | *free text* (required) |
| 4 | Suffix | Jr. · Sr. · II · III · IV · Esq. |
| 5 | Prior Name (maiden/former) | *free text* |
| 6 | Preferred Name | *free text* |
| 7 | Date of Birth | *date* |
| 8 | Pronouns | He/Him · She/Her · They/Them · Ze/Zir · Other |
| 9 | Citizenship / immigration status | Unknown / not confirmed · US Citizen · Permanent Resident · Non-Resident Alien · Non-US — status unconfirmed · Other |

**Contact Information**

| # | Question | Type |
|---|---|---|
| 10 | Email | *email* |
| 11 | Phone | *phone* |

**Address** (the client can search to auto-fill, or type it in)

| # | Question | Type / Choices |
|---|---|---|
| 12 | Search Address | address lookup |
| 13 | Street Address | *free text* |
| 14 | City | *free text* |
| 15 | State | *free text* (defaults to MA) |
| 16 | ZIP | *free text* |
| 17 | County | Barnstable · Berkshire · Bristol · Dukes · Essex · Franklin · Hampden · Hampshire · Middlesex · Nantucket · Norfolk · Plymouth · Suffolk · Worcester |

---

## Section 3 — Family
*Marital status & dependents* · ~2 min

1. **Marital Status**
   - Single
   - Married
   - Divorced
   - Widowed
   - Separated
   - Domestic partner
   - Civil union
   - Unmarried partnership

2. **Do you have children?**
   - Yes
   - No

3. **Do you have children under 18?**: **shown only if** "Do you have children?" = Yes
   - Yes
   - No

> Info shown: *"The information you share here helps us understand your family situation so we can prepare the right documents. If you are married, we'll ask about your spouse next. If you have children, we'll collect their details in a following step."*

---

## Section 4 — Spouse Information
*Spouse's details* · ~3 min · **Shown only if** Marital Status = Married

| # | Question | Type / Choices |
|---|---|---|
| 1 | First Name | *free text* (required) |
| 2 | Middle Name | *free text* |
| 3 | Last Name | *free text* (required) |
| 4 | Suffix | Jr. · Sr. · II · III · IV · Esq. |
| 5 | Prior Name (maiden/former) | *free text* |
| 6 | Preferred Name | *free text* |
| 7 | Date of Marriage | *date* |
| 8 | Date of Birth | *date* |
| 9 | Pronouns | He/Him · She/Her · They/Them · Ze/Zir · Other |
| 10 | Citizenship / immigration status | Unknown / not confirmed · US Citizen · Permanent Resident · Non-Resident Alien · Non-US — status unconfirmed · Other |

**Contact**

| # | Question | Type |
|---|---|---|
| 11 | Email | *email* |
| 12 | Phone | *phone* |

---

## Section 5 — Children
*Children's information* · ~3 min · **Shown only if** "Do you have children?" = Yes

The client clicks **Add child** once per child. Each child asks:

| # | Question | Type / Choices |
|---|---|---|
| 1 | First Name | *free text* |
| 2 | Middle Name | *free text* |
| 3 | Last Name | *free text* |
| 4 | Suffix | Jr. · Sr. · II · III · IV · Esq. |
| 5 | Date of Birth | *date* |
| 6 | Relationship | Biological *(default)* · Adopted · Stepchild |
| 7 | Pronouns | He/Him · She/Her · They/Them · Ze/Zir · Other |
| 8 | Email | *email* |
| 9 | Phone | *phone* |
| 10 | Same address as client | toggle (on / off) |
| 11 | Parent | Both *(default)* · *[Client's first name]* · *[Spouse's first name]*, shown only if married |

---

## Section 6 — Financial
*Assets & financial overview* · ~5 min

1. **Estimated Total Estate Value**
   - Under $500,000
   - $500,000 to $2 million
   - $2 million to $4 million
   - $4 million to $6 million
   - Over $6 million

2. **What types of assets do you own?**: check all that apply
   - Real Estate
   - Bank Accounts
   - Investment Accounts (Non-Retirement)
   - Retirement Accounts
   - Life Insurance
   - Business Interests
   - Custodial Accounts
   - Cryptocurrency
   - Personal Property
   - Other Assets
   - Liabilities / Money You Owe

   Each checked asset type has an optional **Add details** button. *"These details are optional. Rough estimates are fine, and you can skip for now and add more at your appointment."*

   **Real Estate: details** (one row per property; **Add Property**)
   | Field | Type / Choices |
   |---|---|
   | Type | Residential · Commercial · Rental · Vacation Home · Land · Other |
   | Owner | Client *(default)* · Spouse · Joint |
   | Address | *free text* |
   | Estimated Value | *free text* (e.g. $500,000) |
   | Mortgage Balance | *free text* (e.g. $200,000 or None) |
   | Notes | *free text*: held in trust, co-owned, rented, etc. |

   **Business Interests: details** (one row per business; **Add Business**)
   | Field | Type / Choices |
   |---|---|
   | Name of Business | *free text* |
   | Type | Sole Proprietorship · LLC · Partnership · Corporation · Other |
   | Owner | Client *(default)* · Spouse · Joint |
   | Size of Interest (%) | *free text* |
   | Estimated Value | *free text* |

   **Liabilities / Money You Owe: details** (one row per debt; **Add Liability**)
   | Field | Type / Choices |
   |---|---|
   | Description | *free text*: mortgage, auto loan, credit card… |
   | Amount Owed | *free text* |
   | Owner | Client *(default)* · Spouse · Joint |

   **Bank Accounts / Investment Accounts / Retirement Accounts / Life Insurance / Custodial Accounts / Cryptocurrency: details**
   *"Enter approximate totals for all [asset type] combined."*
   | Field | Type |
   |---|---|
   | [Client's first name]'s Total | *free text* ($) |
   | [Spouse's first name]'s Total | *free text* ($) |
   | Joint Total | *free text* ($) |

   **Personal Property / Other Assets: details**
   | Field | Type |
   |---|---|
   | Describe your [asset type], with approximate values if known | *free text* |

3. **Special Circumstances**: a separate on/off toggle for each. Turning one on shows a *"Please provide additional information…"* text box.
   - I own real estate outside Massachusetts
   - I own or co-own a business
   - I have a dependent with special needs
   - I have children from a prior relationship
   - I expect to receive a significant inheritance
   - I want to include charitable giving in my plan

---

## Section 7 — Goals & Wishes
*Priorities & special wishes* · ~4 min

1. **Why did you choose Aubrey Law?** *(optional)*: *free text*
   - *Why we ask:* This helps us understand what mattered to you when choosing counsel and tailor your first conversation.

2. **Why are you planning now?** *(optional)*: *free text*
   - *Why we ask:* Your timing and motivation help your attorney focus the plan on what is driving you right now.

3. **Is making things easy for loved ones important to you?** *(optional)*: *free text*
   - *Why we ask:* Many clients want to spare family from confusion, conflict, or extra court steps. Your answer shapes how we structure the plan.

4. **What are your estate planning goals?**: select all that apply
   - **Avoid probate**: Keep estate settlement private and faster
   - **Protect my spouse**: Ensure my spouse is provided for
   - **Protect my children**: Provide for children and protect their inheritance
   - **Minimize estate taxes**: Reduce tax burden on the estate
   - **Charitable giving**: Include donations to causes I care about
   - **Plan for incapacity**: Ensure someone can act on my behalf if needed
   - **Business succession**: Plan for business continuity
   - **Medicaid planning**: Protect assets for long-term care

**Additional Planning Information**

5. **Do you have a will, trust, or other estate planning document?**
   - Yes → upload will, trust, or other estate planning documents
   - No

6. **Are you making payments pursuant to a divorce or property settlement order?**
   - Yes → upload divorce or property settlement order
   - No

7. **Do you own a long-term care (nursing home) insurance policy?**
   - Yes
   - No

8. **Have you ever filed federal or state gift tax returns?**
   - Yes → upload federal or state gift tax returns
   - No

9. **Anything else you'd like us to know?**: *free text* (concerns, questions, or wishes)

---

## Section 8 — Additional Contacts *(optional)*
*Other people you may name as fiduciaries* · ~3 min

> *"Add siblings, trusted friends, or professionals you might name under Fiduciaries (trustee, power of attorney, health care proxy, guardian, etc.). This step is optional — you only need people you already want the firm to have on file."*

The client clicks **Add contact** once per person. Each contact asks:

| # | Question | Type / Choices |
|---|---|---|
| 1 | First name | *free text* |
| 2 | Middle name | *free text* |
| 3 | Last name | *free text* |
| 4 | Suffix | Jr. · Sr. · II · III · IV · Esq. |
| 5 | Relationship to you | *free text* (e.g. Sister, Cousin, Financial advisor) |
| 6 | Email | *email* |
| 7 | Phone | *phone* |
| 8 | Pronouns | He/Him · She/Her · They/Them · Ze/Zir · Other |
| 9 | Address | Search Address · Street Address · City · State · ZIP |

---

## How fiduciary roles work (Sections 9–11)

Every fiduciary role below works the same way:

- **Primary**: pick one person from the contact list (client, spouse, children, additional contacts, and anyone already named in another role), or **Add contact** to enter someone new.
- **Add alternate**: up to 5 people in order of priority (Primary, Alternate 1, Alternate 2…).
- **Add co-agent**: a co-agent can be added for each Primary/Alternate. *Not offered for Health Care Proxy or excluded guardians.*
- **New contact fields:** First Name · Middle Name · Last Name · Suffix (Jr. · Sr. · II · III · IV · Esq.) · Email · Phone · Relationship (*free text*) · Pronouns (He/Him · She/Her · They/Them · Ze/Zir · Other) · Address (Search · Street · City · State · ZIP)

**Reason for blank roles.** Each fiduciary section starts with: *"If you are leaving any … roles blank, choose the reason so your attorney knows it is intentional."*
- Discuss with attorney
- Not provided yet

---

## Section 9 — Your Fiduciaries
*Trustees, agents & proxies* · ~7 min

> *"Name the people who would step in to manage your trust, settle your estate, and make decisions if you cannot. Many clients choose a spouse, adult child, or trusted sibling — you can leave any role blank and discuss options with Aubrey Law."*
>
> Expandable **"Learn more about these roles"** explains Successor Trustee vs. Personal Representative, and trust-based vs. will-based plans.

1. **Reason for blank roles**: Discuss with attorney · Not provided yet
2. **Successor Trustee**: manages trust assets. *Example: an adult child or trusted sibling who is organized and comfortable managing finances.* (Primary · Alternates · Co-agents)
3. **Personal Representative (Executor)**: settles the probate estate. *Example: a family member who can handle paperwork, court filings, and communicating with heirs.* (Primary · Alternates · Co-agents)
4. **Financial Power of Attorney**: manages finances and legal matters during incapacity. *Example: your spouse or adult child who would pay bills and manage accounts if you were hospitalized.* (Primary · Alternates · Co-agents)
5. **Health Care Proxy**: makes medical decisions if the client cannot. *Example: someone who knows your wishes and would speak with doctors on your behalf.* (Primary · Alternates; no co-agent)

---

## Section 10 — Spouse's Fiduciaries
*Spouse's trustees & agents* · ~5 min · **Shown only if** Marital Status = Married

> *"These are the people [spouse] would like to serve as their fiduciaries. They may be the same as yours or different."*

1. **Reason for blank roles**: Discuss with attorney · Not provided yet
2. **[Spouse]'s Personal Representative**: manages the spouse's probate estate. (Primary · Alternates · Co-agents)
3. **[Spouse]'s Financial Power of Attorney**: manages the spouse's finances and legal matters during incapacity. (Primary · Alternates · Co-agents)
4. **[Spouse]'s Health Care Proxy**: makes medical decisions on the spouse's behalf. (Primary · Alternates; no co-agent)

*The spouse is not offered as a choice for their own roles; the client is.*

---

## Section 11 — Guardian for Minors
*Care for minor children* · ~2 min · **Shown only if** "Do you have children under 18?" = Yes

1. **Reason for blank roles**: Discuss with attorney · Not provided yet
2. **Guardian for Minor Children**: raises minor children and is responsible for their care, custody, and control until adulthood. *Example: a relative or close friend who shares your values and would raise your children if both parents could not.* (Primary · Alternates · Co-agents)
   - The client and spouse appear as choices only when at least one child belongs to just one of them.
3. **Is there anyone you specifically do NOT want as guardian?**
   - Yes → **Person(s) to exclude as guardian** (add one or more people; no co-agent)
   - No

---

## Section 12 — Review & Submit
*Confirm & submit* · ~2 min

The client sees a read-only summary of every answered section, plus a checklist of any open issues. Only missing **contact information** blocks submission. Other gaps, such as unnamed fiduciaries, show as warnings and the client can still submit.

---

## Section display summary

| # | Section | When shown |
|---|---|---|
| 1 | Getting Started | Always *(optional)* |
| 2 | Personal Information | Always |
| 3 | Family | Always |
| 4 | Spouse Information | Marital Status = Married |
| 5 | Children | Has children = Yes |
| 6 | Financial | Always |
| 7 | Goals & Wishes | Always |
| 8 | Additional Contacts | Always *(optional)* |
| 9 | Your Fiduciaries | Always |
| 10 | Spouse's Fiduciaries | Marital Status = Married |
| 11 | Guardian for Minors | Has children under 18 = Yes |
| 12 | Review & Submit | Always |
