import React, { PropTypes } from 'react';

class HomePage extends React.Component {
  constructor(props, context) {
    super(props, context);
    this.state = {
      terminalData: []
    };
    this.socket = this.context.socket;
  }

  componentWillMount() {
    this.socket.on('inputStream', (data) => {
      if (data.stream) {
        this.setState({
          terminalData: [...[data.stream], ...this.state.terminalData]
        });
      }
    });
  }

  render() {
    return (
      <div className="ui very relaxed stackable centered grid">
        <div className="ui fluid row">
          <div className="one column row">
            <div className="column">
              <div className="ui card" style={{ width: '100%' }}>
                <div className="content">
                  <div className="header">Terminal</div>
                </div>
                <div className="content">
                  <div className="ui padded raised segment container"
                       style={{ height: '52vh', backgroundColor: 'black',
                         color: 'white', overflowY: 'scroll' }}
                  >
                    {this.state.terminalData.map((data) =>
                      <p key={Math.random()}>{data}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    );
  }
}

HomePage.contextTypes = {
  socket: PropTypes.object.isRequired
};

export default HomePage;
