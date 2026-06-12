/**
 * 短信发送服务
 * 支持 Twilio 发送短信，未配置时打印到控制台（开发用）
 */

// Twilio 配置
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || ''

/**
 * 发送短信验证码
 * @param phone 手机号
 * @param code 验证码
 */
export async function sendVerificationSMS(phone: string, code: string): Promise<boolean> {
  // 如果配置了 Twilio，使用 Twilio 发送
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
    try {
      // 动态导入 twilio（仅在需要时配置了 Twilio 才使用）
      // @ts-expect-error - twilio 是可选依赖，仅在配置时才需要
      const { default: twilio } = await import('twilio')
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

      await client.messages.create({
        body: `【ChatRoom】您的验证码是 ${code}，有效期 10 分钟。`,
        from: TWILIO_PHONE_NUMBER,
        to: phone,
      })

      console.log(`短信验证码已发送到 ${phone}`)
      return true
    } catch (error) {
      console.error('发送短信失败:', error)
      return false
    }
  }

  // 未配置 SMS 服务时，打印到控制台
  console.log(`[短信服务未配置] 验证码 ${code} 已发送到 ${phone}（实际未发送）`)
  console.log(`提示：在 .env 中配置 TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER 即可启用短信`)
  console.log(`========================================`)
  console.log(`  手机号: ${phone}`)
  console.log(`  验证码: ${code}`)
  console.log(`========================================`)
  return false
}