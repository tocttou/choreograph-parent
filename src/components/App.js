import React, { PropTypes } from 'react';
import AppBar from 'material-ui/AppBar';
import { Link } from 'react-router';
import { connect } from 'react-redux';
import io from 'socket.io-client';

class App extends React.Component {
  constructor(props, context) {
    super(props, context);
    this.socket = io();
    this.socket.on('connect', () => {
      this.socket.emit('hello');
    });
  }

  getChildContext() {
    return {
      socket: this.socket
    };
  }

  componentWillMount() {
    this.socket.on('world', (data) => {
    });
  }


  render() {
    return (
      <div>
        <AppBar
          zDepth={0}
          title={
            <Link to="/"
                  style={{
                    textDecoration: 'none', color: 'inherit', outline: 'none'
                  }}
            >
              Choreograph (Walmart Labs Hackathon)
            </Link>
          }
          showMenuIconButton = {false}
        />
        {this.props.children}
      </div>
    );
  }
}

App.propTypes = {
  children: PropTypes.object.isRequired
};

App.childContextTypes = {
  socket: PropTypes.object.isRequired
};

function mapStateToProps(state, ownProps) {
  return {
  };
}

export default connect(mapStateToProps)(App);
