import { useState, useEffect } from 'react'

interface SafeImgProps {
  src: string
  fallback: React.ReactNode
  className?: string
  alt?: string
}

export default function SafeImg({ src, fallback, className = '', alt = '' }: SafeImgProps) {
  const [failed, setFailed] = useState(false)

  // src 变化时重置 failed 状态
  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) {
    return <>{fallback}</>
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}