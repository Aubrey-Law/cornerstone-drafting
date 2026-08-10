/**
 * Fallback bodies for the two intake-invitation emails.
 *
 * `sendEmail` prefers the firm's stored default template for the category and
 * only falls back to these, so editing the copy in the templates UI wins. They
 * live here rather than inline in the send route because the College Prep
 * version carries the explanation of *why* the documents matter at 18 — that
 * is the whole reason a parent opens the form.
 *
 * Placeholders use the snake_case `{{name}}` syntax `renderEmailTemplateText`
 * understands — the same set the template builder's variable picker offers.
 *
 * These are full HTML documents, so `sendEmail` does not run them through
 * `wrapEmailWithBrand` (that only applies to stored templates). Nothing
 * downstream appends a signature to an automated send either, so whatever
 * identifies the firm has to be the From address and reply-to the route sets.
 */

export interface IntakeInviteBody {
  subject: string
  html: string
}

export const ESTATE_INTAKE_INVITE: IntakeInviteBody = {
  subject: 'Complete your estate planning intake',
  html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#1f2937;">
<p>Hi {{first_name}},</p>
<p>Please use the secure link below to create your portal password and complete your intake questionnaire.</p>
<p><a href="{{intake_link}}" style="color:#2a7d70;font-weight:600;">Start intake</a></p>
<p style="font-size:13px;color:#6b7280;">You may return to this link until our office revokes or replaces it.</p>
<p>Best,</p>
</body></html>`,
}

export const COLLEGE_PREP_INTAKE_INVITE: IntakeInviteBody = {
  subject: 'College Preparation Plan — intake form inside',
  html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#1f2937;">
<p>Hi {{first_name}},</p>

<p>Thanks for reaching out about getting your college student set up before school starts.</p>

<p>Quick context on why this matters: once your child turns 18, you no longer have automatic authority to make medical decisions, receive information from doctors, access academic records, or handle financial and administrative matters on their behalf — even while they&rsquo;re on your insurance and you&rsquo;re paying tuition. Hospitals and schools are bound by HIPAA and FERPA regardless of the family relationship.</p>

<p>The College Preparation Plan closes that gap with four documents:</p>

<ul>
  <li><strong>Health Care Proxy</strong> — names you (or another trusted adult) to make medical decisions if your child can&rsquo;t</li>
  <li><strong>HIPAA Authorization</strong> — lets providers share medical information with you</li>
  <li><strong>Durable Power of Attorney</strong> — allows you to handle financial and administrative matters (bank accounts, insurance, leases, car issues)</li>
  <li><strong>FERPA Release</strong> — allows the school to discuss grades, billing, and disciplinary matters with you</li>
</ul>

<p>To get started, please complete the intake form — about 20 minutes:</p>

<p><a href="{{intake_link}}" style="color:#2a7d70;font-weight:600;">Start the intake form</a></p>

<p>A few notes as you fill it out:</p>

<ul>
  <li>Your student should complete it, or you can complete it together — the documents are signed by your child, since they&rsquo;re the adult granting the authority</li>
  <li>You&rsquo;ll need names and contact information for the agents you want named, plus one alternate for each role</li>
  <li>If your student is attending school out of state, note that on the form so I can flag any additional considerations</li>
</ul>

<p>Please let me know if you have any questions.</p>

<p>Best,</p>
</body></html>`,
}
