// A page that could not be shown. The meal plan and the Workshop load when they are first opened
// (App.tsx), and that download can fail: a weak signal, or a new build that took the old files
// away. Without this boundary React would unmount the whole console and leave a blank page, header
// and navigation gone, and Back would not bring it back. With it, around each page inside <main>,
// only the page's own place says what happened, calmly, and the header, the navigation and the
// browser's Back keep working; leaving the page (Back, the navigation) leaves the failure with it.
//
// Try again loads the console afresh at this address: a browser remembers a module that failed to
// download and will not ask for it again until the page is loaded anew. Offline, a reload would
// trade this page for the browser's own error page, so Try again says so and waits instead.
// It catches anything the page throws while it draws, not only a failed download, so its words
// stay true either way: the page could not be shown, and what was planned is kept.
import { Component } from 'react';
import type { ReactNode } from 'react';

import { Notice } from './ui';
import type { NoticeAction } from './ui';

interface Props {
  // what the page is, at the start of a sentence: "The meal plan", "Your trip", "The Workshop"
  what: string;
  // the page's own way back, when it has one (in-store mode: the shopping plan)
  back?: NoticeAction;
  children: ReactNode;
}

interface State {
  failed: boolean;
  offline: boolean;
}

export class PageBoundary extends Component<Props, State> {
  state: State = { failed: false, offline: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  private again = () => {
    if (navigator.onLine === false) this.setState({ offline: true });
    else window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { what, back } = this.props;
    const actions: NoticeAction[] = [{ label: 'Try again', icon: 'refresh', onClick: this.again }];
    if (back) actions.push(back);
    return (
      <div className="view">
        <Notice tone="warn" title={`${what} could not be loaded`} actions={actions}
                hint={this.state.offline ? 'This device is offline: try again once it has a signal.' : undefined}>
          The connection may have dropped, or the console has been updated since it opened. What you
          planned is kept in this browser.
        </Notice>
      </div>
    );
  }
}
