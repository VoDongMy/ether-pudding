var Promise = require("bluebird");
var pkg = require("./package.json");


// fix this issue:
// https://github.com/ethereum/web3.js/issues/337
// XXX this should really be Pudding.toUTF8
Pudding.toAscii = function(hex) {
    var str = '',
        i = 0,
        l = hex.length;
    if (hex.substring(0, 2) === '0x') {
        i = 2;
    }
    for (; i < l; i+=2) {
        var code = parseInt(hex.substr(i, 2), 16);
        if (code === 0) continue; // this is added
        str += String.fromCharCode(code);
    }
    return str;
}       


//
// This parses a multi-return values into a struct, giving
// use pseudo-capability of returning structs from solidity,
// as well as making it consistant with log events.  Note the
// ABI produced by solidity supports this.
//
// it also properly converts bytes32 to usable string
//
Pudding.newReturn = function(rv, fnabi) {
 
  newrv = [];
  if (rv.constructor === Array) {
    fnabi.outputs.forEach(function(x,i) {
      if (x.type == 'bytes32') {
        rv[i] = Pudding.toAscii(rv[i]);
      }
      newrv[x.name] = rv[i];
    })
    return newrv;
  } else {
    if (fnabi.outputs[0].type == 'bytes32') {
      rv = Pudding.toAscii(rv);
    }
    return rv;
  }
}

var SolidityEvent = require("web3/lib/web3/event.js");
Pudding.logParser = function (logs, abi) {

  // pattern similar to lib/web3/contract.js:  addEventsToContract()
  var decoders = abi.filter(function (json) {
    return json.type === 'event';
  }).map(function(json) {
    // note first and third params only required only by enocde and execute;
    // so don't call those!
    return new SolidityEvent(null, json, null);
  });

  return logs.map(function (log) {
    var decoder = decoders.find(function(decoder) {
      return (decoder.signature() == log.topics[0].replace("0x",""));
    })
    if (decoder) { 
        return decoder.decode(log);
    } else { 
        return log;
    }
  }).map(function (log) {
    abis = abi.find(function(json) {
      return (json.type === 'event' && log.event === json.name);
    });
    if (abis && abis.inputs) {
        abis.inputs.forEach(function (param, i) {
        if (param.type == 'bytes32') {
            log.args[param.name] = Pudding.toAscii(log.args[param.name]); 
        }
        })
    }
    return log;
  })
}

Pudding.newTx = function(tx, tx_info, logFunc, accept, reject, abi, eth) {
  eth.getTransactionReceipt(tx, function(e, tx_receipt) {
    if (e != null || tx_receipt == null) {
      reject(new Error(e));
    }

    // make sure fields include all the fields from web3 events plus anything useful from tx_info
    if (tx_receipt.logs.length > 0) { 
        var logs = Pudding.logParser(tx_receipt.logs, abi);
        tx_receipt.type = tx_receipt.logs[0].type;
        tx_receipt.logs = logs;
    }
    tx_receipt.gasSent = tx_info.gas;
    logFunc(tx_receipt);
    if (tx_receipt.gasUsed >= tx_info.gas) {
      logFunc(tx_receipt);
      reject(new Error("Transaction " + tx + " used up all gas " + tx_receipt.gasUsed));
    } else {
      accept(tx_receipt);
    }
  })
}

function Pudding(contract) {
  if (!this.abi) {
    throw new Error("Contract ABI not set. Please inherit Pudding and set static .abi variable with contract abi.");
  }

  this.contract = contract;
  this.address = contract.address;

  for (var i = 0; i < this.abi.length; i++) {
    var fn = this.abi[i];
    if (fn.type == "function") {
      if (fn.constant == true) {
        this[fn.name] = this.constructor.promisifyFunction(this.contract[fn.name], 
                                                           Pudding.class_defaults.return_hook,
                                                           fn);
      } else {
        this[fn.name] = this.constructor.synchronizeFunction(this.contract[fn.name], this.contract);
      }

      this[fn.name].call = this.constructor.promisifyFunction(this.contract[fn.name].call,
                                                              Pudding.class_defaults.return_hook,
                                                              fn);
      this[fn.name].sendTransaction = this.constructor.promisifyFunction(this.contract[fn.name].sendTransaction);
      this[fn.name].request = this.contract[fn.name].request;
      this[fn.name].estimateGas = this.constructor.promisifyFunction(this.contract[fn.name].estimateGas);
    }

    if (fn.type == "event") {
      this[fn.name] = this.contract[fn.name];
    }
  }

  this.allEvents = this.contract.allEvents;
};

Pudding.new = function() {
  var args = Array.prototype.slice.call(arguments);
  var web3 = this.web3;
  if (web3 == undefined) {
    console.log(this);
    console.log(new Error().stack);
    throw(Error("undefined web3, figure out the callstack issue"));
  }
  //console.log(this);

  if (!this.prototype.binary) {
    throw new Error("Contract binary not set. Please override Pudding and set .binary before calling new()");
  }

  var self = this;

  return new Promise(function(accept, reject) {
    var contract_class = web3.eth.contract(self.prototype.abi);
    var tx_params = {};
    var last_arg = args[args.length - 1];

    // It's only tx_params if it's an object and not a BigNumber.
    if (Pudding.is_object(last_arg) && last_arg instanceof Pudding.BigNumber == false) {
      tx_params = args.pop();
    }

    tx_params = Pudding.merge(Pudding.class_defaults, self.prototype.class_defaults, tx_params);

    if (tx_params.data == null) {
      tx_params.data = self.prototype.binary;
    }

    // web3 0.9.0 and above calls new twice this callback twice.
    // Why, I have no idea...
    var intermediary = function(err, web3_instance) {
      if (err != null) {
        reject(err);
        return;
      }

      if (err == null && web3_instance != null && web3_instance.address != null) {
        accept(new self(web3_instance));
      }
    };

    args.push(tx_params, intermediary);

    contract_class.new.apply(contract_class, args);
  });
};

Pudding.at = function(address) {
  var web3 = this.web3;
  var contract_class = web3.eth.contract(this.prototype.abi);
  var contract = contract_class.at(address);

  return new this(contract);
};

Pudding.deployed = function() {
  if (!this.prototype.address) {
    throw new Error("Contract address not set - deployed() relies on the contract class having a static 'address' value; please set that before using deployed().");
  }

  return this.at(this.prototype.address);
};

Pudding.extend = function() {
  var args = Array.prototype.slice.call(arguments);

  for (var i = 0; i < arguments.length; i++) {
    var object = arguments[i];
    var keys = Object.keys(object);
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      var value = object[key];
      this.prototype[key] = value;
    }
  }
};

Pudding.whisk = function(data, constructor) {

/*
  if (this.web3 == null) {
    throw new Error("Please set data.web3 or call Pudding.setWeb3() before calling Pudding.whisk().");
  }
*/

  var Contract = constructor;

  if (constructor == null) {
    Contract = function(contract) {
      Pudding.apply(this, arguments);
    };
  }

  Contract.prototype = Object.create(Pudding.prototype);

  Contract.abi = Contract.prototype.abi = data.abi;
  Contract.binary = Contract.prototype.binary = data.binary;
  Contract.unlinked_binary = Contract.prototype.unlinked_binary = data.unlinked_binary || data.binary;
  Contract.prototype.class_defaults = data.defaults || {};
  Contract.address = Contract.prototype.address = data.address;
  Contract.deployed_address = Contract.prototype.deployed_address = data.address; // deprecated
  Contract.generated_with = Contract.prototype.generated_with = data.generated_with;
  Contract.contract_name = Contract.prototype.contract_name = data.contract_name;
  Contract.web3 = data.web3 || Pudding.getWeb3();

  // Post-whisked loads just return the contract.
  Contract.load = function() {
    return Contract;
  };

  Contract.new = Pudding.new.bind(Contract);
  Contract.at = Pudding.at.bind(Contract);
  Contract.deployed = Pudding.deployed.bind(Contract);
  Contract.extend = Pudding.extend.bind(Contract);

  return Contract;
}

Pudding.load = function(factories, scope) {
  if (scope == null) {
    scope = {};
  }

  if (!(factories instanceof Array)) {
    factories = [factories];
  }

  var names = [];

  for (var i = 0; i < factories.length; i++) {
    var factory = factories[i];
    var result = factory.load(this);
    names.push(result.contract_name);
    scope[result.contract_name] = result;
  }

  return names;
};

Pudding.defaults = function(class_defaults) {
  if (this.class_defaults == null) {
    this.class_defaults = {};
  }

  if (class_defaults == null) {
    class_defaults = {};
  }

  var keys = Object.keys(class_defaults);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = class_defaults[key];
    this.class_defaults[key] = value;
  }
  return this.class_defaults;
}

Pudding.setWeb3 = function(web3) {

  if (web3.toBigNumber == null) {
    throw new Error("Pudding.setWeb3() must be passed an instance of Web3 and not Web3 itself.");
  }

  this.BigNumber = web3.toBigNumber(0).constructor;
  this.web3 = web3;
};

Pudding.getWeb3 = function() {
  return this.web3 || Pudding.web3; // Note: Pudding often times === this;
}

Pudding.is_object = function(val) {
  return typeof val == "object" && !(val instanceof Array);
};

Pudding.merge = function() {
  var merged = {};
  var args = Array.prototype.slice.call(arguments);

  for (var i = 0; i < args.length; i++) {
    var object = args[i];
    var keys = Object.keys(object);
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      var value = object[key];
      merged[key] = value;
    }
  }

  return merged;
};

Pudding.promisifyFunction = function(fn, hook, fnabi) {
  var self = this;
  return function() {
    var instance = this;

    var args = Array.prototype.slice.call(arguments);
    var tx_params = {};
    var last_arg = args[args.length - 1];

    // It's only tx_params if it's an object and not a BigNumber.
    if (Pudding.is_object(last_arg) && last_arg instanceof Pudding.BigNumber == false) {
      tx_params = args.pop();
    }

    tx_params = Pudding.merge(Pudding.class_defaults, self.class_defaults, tx_params);

    return new Promise(function(accept, reject) {
      var callback = function(error, result) {
        if (error != null) {
          reject(error);
        } else {
          if (hook) {
            result = hook(result, fnabi);
          }
          accept(result);
        }
      };
      args.push(tx_params, callback);
      fn.apply(instance.contract, args);
    });
  };
};


Pudding.synchronizeFunction = function(fn, contract) {
  var self = this;
  var thisContract = contract;
  var abi = contract.abi;
  return function() {
    var args = Array.prototype.slice.call(arguments);
    var tx_params = {};
    var last_arg = args[args.length - 1];
    var tx_hook; 
    var tx_log; 
    var tx_timeout = 0;

    // It's only tx_params if it's an object and not a BigNumber.
    if (Pudding.is_object(last_arg) && last_arg instanceof Pudding.BigNumber == false) {
      tx_params = args.pop();
    }
    tx_params = Pudding.merge(Pudding.class_defaults, self.class_defaults, tx_params);
    tx_hook = Pudding.class_defaults.tx_hook;
    if (typeof tx_hook === 'undefined' || tx_hook === null || tx_hook === {}) {
      tx_hook = function(tx, tx_info, logFunc, accept) {logFunc(tx_info); accept(tx)};
    }
    tx_log = Pudding.class_defaults.tx_log;
    if (typeof tx_log === 'undefined' || tx_log === null || tx_log === {}) {
      tx_log = function(tx){};
    }
    tx_timeout = Pudding.class_defaults.tx_timeout;
    if (typeof tx_timeout  === 'undefined' || tx_timeout === null || tx_timeout === 0) {
      tx_timeout = 240000;  // original default with this library
    }
    if(tx_params.abi) {
        // XXX need to handle multiple ABIs in the future, via an {address,abi} pair
        abi = tx_params.abi;
    }


    return new Promise(function(accept, reject) {

      var callback = function(error, tx) {
        var interval = null;
        var max_attempts = tx_timeout / 1000;
        var attempts = 0;

        if (error != null) {
          reject(error);
          return;
        }

        var interval;

        var make_attempt = function() {
          //console.log "Interval check //{attempts}..."
          thisContract._eth.getTransaction(tx, function(e, tx_info) {
            // If there's an error ignore it.  Sometimes tx_info is null, don't know why
            if (e != null || tx_info == null) {
              return;
            }

            if (tx_info.blockHash != null) {
              clearInterval(interval);
              tx_hook(tx, tx_info, tx_log, accept, reject, abi, thisContract._eth);
            }

            if (attempts >= max_attempts) {
              clearInterval(interval);
              reject(new Error("Transaction " + tx + " wasn't processed in " + attempts + " attempts!"));
            }

            attempts += 1;
          });
        };

        interval = setInterval(make_attempt, 1000);
        make_attempt();
      };

      args.push(tx_params, callback);
      fn.apply(self, args);
    });
  };
};

Pudding.class_defaults = {};
Pudding.version = pkg.version;

module.exports = Pudding;
