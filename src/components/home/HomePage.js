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
      <div className="ui very relaxed stackable container grid">
        <div className="ui row">
          <iframe width="560" height="315" src="https://www.youtube.com/embed/GzpasVWDx6g" frameBorder="0" allowFullScreen></iframe>
        </div>
        <div className="ui row">
          <br />
          <div className="ui info message">
            Files used in the demo are given here.
          </div>
        </div>
        <div className="ui row">
          <a href="https://gist.github.com/tocttou/2c49c15b35a6bd47caf8e2d508fe1351">.choreo.yml</a>
        </div>
        <div className="ui row">
          <a href="https://gist.github.com/tocttou/3ae4eed85fb911f9d819c82615c37dc4">payload/file1.json</a>
        </div>
        <div className="ui row">
          <a href="https://gist.github.com/tocttou/129039e181b4795fa47f12d2446001c7">payload/file2.txt</a>
        </div>
        <div className="ui row">
          <a href="https://gist.github.com/tocttou/cd9c0ed3ea224d71662ea1ca5796785b">payload/app.py</a>
        </div>
        <div className="ui row">
          <a href="https://gist.github.com/tocttou/4e9e4722d5b4294f73d21792cf345307">payload/app.js</a>
        </div>
      </div>
    );
  }
}

HomePage.contextTypes = {
  socket: PropTypes.object.isRequired
};

export default HomePage;
