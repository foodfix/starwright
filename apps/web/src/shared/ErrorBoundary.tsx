import { Component, type ComponentType, type ReactNode } from 'react';
import { withTranslation, type WithTranslation } from 'react-i18next';

interface OwnProps {
  children: ReactNode;
  label: string;
}

interface Props extends OwnProps, WithTranslation {}

interface State {
  error: Error | null;
}

/** Keep one broken entry from blanking the whole stream. */
class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <p className="msg error">
          {this.props.t('errorBoundary.failed', {
            label: this.props.label,
            message: this.state.error.message,
          })}
        </p>
      );
    }
    return this.props.children;
  }
}

export const ErrorBoundary: ComponentType<OwnProps> = withTranslation()(Boundary);
