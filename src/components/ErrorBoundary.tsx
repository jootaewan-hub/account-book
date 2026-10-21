import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** 어느 화면인지(오류 문장에 쓴다). 부르는 쪽이 key로도 쓰면 화면을 옮길 때 오류 상태가 함께 풀린다 */
  name: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 한 화면(탭·시트)이 그리다 멈추면 앱 전체가 흰 화면이 되는 대신 그 자리에 오류와 다시 시도를 보여 준다.
 * 데이터 요청 실패는 각 화면이 스스로 처리하고, 여기는 그리는 중 던져진 예외만 받는다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 운영에서는 콘솔에만 남긴다(외부로 보내지 않는다)
    console.error(`[${this.props.name}] 화면을 그리지 못했어요`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card error-card" role="alert">
        <b>{this.props.name} 화면을 그리지 못했어요</b>
        <span className="lead">다시 시도해도 같으면 새로 고침해 주세요. 저장된 기록은 그대로 있어요.</span>
        <p className="err">{this.state.error.message}</p>
        <div className="error-actions">
          <button className="ghost" onClick={() => this.setState({ error: null })}>다시 시도</button>
          <button className="ghost" onClick={() => window.location.reload()}>새로 고침</button>
        </div>
      </div>
    )
  }
}
