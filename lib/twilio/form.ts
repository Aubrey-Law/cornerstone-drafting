/** Parse application/x-www-form-urlencoded body from Twilio webhooks. */
export async function parseTwilioForm(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text()
    const params: Record<string, string> = {}
    for (const pair of text.split('&')) {
      if (!pair) continue
      const [rawKey, rawValue = ''] = pair.split('=')
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
      const value = decodeURIComponent(rawValue.replace(/\+/g, ' '))
      params[key] = value
    }
    return params
  }

  const form = await req.formData()
  const params: Record<string, string> = {}
  form.forEach((value, key) => {
    params[key] = value.toString()
  })
  return params
}
