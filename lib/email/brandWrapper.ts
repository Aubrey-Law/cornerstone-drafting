// Branded wrapper for stored-template (bare-body) emails. When the global
// `email_logo_header` toggle is on, sendEmail passes a rendered template body
// through this to add the AUBREY LAW wordmark header + footer.
//
// The "logo" is a text wordmark (Georgia serif, navy + teal), NOT the .svg —
// email clients (Gmail especially) strip SVG and block images by default, so a
// styled-text wordmark is the reliable, always-renders choice. It mirrors
// public/aubrey-law-logo.svg (AUBREY #1a3a5c, LAW #2a7d70).

export interface BrandWrapInfo {
  firmName: string
  email: string
  city?: string
}

// A full HTML document already carries its own header/layout (e.g. the intake
// invite route). Only bare body fragments should be wrapped.
export function isFullEmailDocument(html: string): boolean {
  return /<!DOCTYPE|<html[\s>]/i.test(html)
}

export function wrapEmailWithBrand(bodyHtml: string, info: BrandWrapInfo): string {
  const cityLine = info.city ? `${info.city}, MA` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td align="center" style="padding:40px 40px 16px;">
              <p style="margin:0;font-family:Georgia,'Palatino Linotype',Palatino,'Book Antiqua',serif;font-size:30px;font-weight:normal;letter-spacing:2px;line-height:1;">
                <span style="color:#1a3a5c;">AUBREY</span> <span style="color:#2a7d70;">LAW</span>
              </p>
              <p style="margin:10px 0 0;font-family:Georgia,'Palatino Linotype',Palatino,serif;font-size:11px;letter-spacing:1px;color:#9ab0be;">
                Your Legacy. Carefully Planned.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;">
              <div style="border-top:1px solid #e5e7eb;line-height:1px;font-size:1px;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 40px 32px;font-size:15px;color:#374151;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                ${info.firmName}${cityLine ? ` &middot; ${cityLine}` : ''}<br />
                <a href="mailto:${info.email}" style="color:#2a7d70;text-decoration:none;">${info.email}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
