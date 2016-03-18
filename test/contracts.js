// Override Pudding
var assert = require("chai").assert;
var Pudding = require("../");
var temp = require("temp").track();;
var solc = require("solc");
var fs = require("fs");
var TestRPC = require("ethereumjs-testrpc");
var Web3 = require("web3");
var PuddingGenerator = require("../generator");
var PuddingLoader = require("../loader");
var BigNumber = require('bignumber');

// Compile first
var result = solc.compile(fs.readFileSync("./test/Example.sol", {encoding: "utf8"}), 1);
if (result.contracts == undefined) {
    console.error(result.errors[0]);
    throw(Error(result.errors[0]));
}

var compiled = result.contracts["Example"];
var abi = JSON.parse(compiled.interface);
var binary = compiled.bytecode;

// Setup
var web3 = new Web3();
web3.setProvider(TestRPC.provider());
//web3.setProvider(new web3.providers.HttpProvider("http://localhost:8110")); // geth
Pudding.setWeb3(web3);

var tests = function(contract_instantiator) {
  var Example;
  var accounts;

  before(function(done) {
    contract_instantiator(function(err, Ex) {
      Example = Ex;
      done(err);
    });
  });

  before(function(done) {
    web3.eth.getAccounts(function(err, accs) {
      accounts = accs;

      Pudding.defaults({
        from: accounts[0],
        gasLimit:  3141592,
        gas:  3141591,
        tx_hook : Pudding.newTx,
        tx_log: function (tx) { } 
      });

      done(err);
    });
  });

  it("should get and set values via methods and get values via .call", function(done) {


    var example;
    Example.new().then(function(instance) {
      example = instance;
      return example.value.call();
    }).then(function(value) {
      assert.equal(value.valueOf(), 1, "Starting value should be 1");
      return example.setValue(5);
    }).then(function(tx) {
      var exampleEvent = tx.logs.find(function(x) { return (x.event == "ExampleEvent") })
      assert.notEqual(exampleEvent.args._from, 0, "first element of first log message should be non-zero");
      assert.equal(exampleEvent.args.foo, 0xaa, "Second element of first log message should be correct");
      assert.equal(exampleEvent.args.bar, 0xbb, "First element of first log message should be correct");
      assert.equal(exampleEvent.address, example.address, "first log message contract address should be correct");
      var secondEvent = tx.logs.find(function(x) { return (x.event == "SecondEvent") })
      assert.equal(secondEvent.args.x, 0xdead, "First element of second log message should be correct");
      assert.equal(secondEvent.args.y, 0xbeefbeef, "Second element of second log message should be correct");
      assert.equal(secondEvent.args.z, 0xdeadbeefdeadbeefdeadbeefdeadbeef, "third element of second log message should be correct");
      assert.equal(Pudding.toAscii(secondEvent.args.info), "testing123", "Fourth element of second log message should be a string");
      assert.equal(secondEvent.address, example.address, "second log message contract address should be correct");
      return example.value.call();
    }).then(function(value) {
      assert.equal(value.valueOf(), 5, "Ending value should be five");
    }).then(done).catch(done);
  });

  it("should add extended functions when created with at()", function(done) {
    Example.extend({
      my_function: function(instance) {
        assert.equal(instance, this, "Function has incorrect scope!");
        done();
      }
    });

    assert.isUndefined(Example.my_function, "Function should not have been applied to the class");
    assert.isNotNull(Example.prototype.my_function, "Function should have been applied to the _extended attribute");

    var example = Example.at(Example.deployed_address);
    assert.isNotNull(example.my_function, "Function should have been applied to the instance");
    example.my_function(example);
  });

  it("should add extended functions when created with new()", function(done) {
    Example.extend({
      my_function: function(instance) {
        assert.equal(instance, this, "Function has incorrect scope!");
        done();
      }
    });

    Example.new().then(function(example) {
      assert.isNotNull(example.my_function, "Function should have been applied to the instance");
      example.my_function(example);
    }).catch(done);
  });

  it("shouldn't synchronize constant functions", function(done) {
    var example;
    Example.new(5).then(function(instance) {
      example = instance;
      return example.getValue();
    }).then(function(value) {
      assert.equal(value.valueOf(), 5, "Value should have been retrieved without explicitly calling .call()");
    }).then(done).catch(done);
  });

  it("should allow BigNumbers as input parameters, and not confuse them as transaction objects", function(done) {
    // BigNumber passed on new()
    var example = null;
    Example.new(new Pudding.BigNumber(30)).then(function(instance) {
      example = instance;
      return example.value.call();
    }).then(function(value) {
      assert.equal(value.valueOf(), 30, "Starting value should be 30");
      // BigNumber passed in a transaction.
      return example.setValue(new Pudding.BigNumber(25));
    }).then(function(tx) {
      return example.value.call();
    }).then(function(value) {
      assert.equal(value.valueOf(), 25, "Ending value should be twenty-five");
      // BigNumber passed in a call.
      return example.parrot.call(new Pudding.BigNumber(865));
    }).then(function(parrot_value) {
      assert.equal(parrot_value.valueOf(), 865, "Parrotted value should equal 865")
    }).then(done).catch(done);
  });

  it("should throw when running out of gas", function(done) {
    var example;
    Example.new().then(function(instance) {
      example = instance;
      return example.value.call();
    }).then(function(value) {
      assert.equal(value.valueOf(), 1, "Starting value should be 1");
      return example.spendGas(100 , {gas: 400000});
    }).then(function(tx) {
      assert.ok(false, "should not have mined a transaction that ran out of gas");
    }).then(done).catch(function(err) {
      assert.ok(true , "Threw an exception when ran out of gas");
      done();
    });
  });
};

describe("Contract abstractions", function() {

  this.timeout(40000);  // enough for stock real node e.g. geth

  describe("when using .whisk()", function() {
    tests(function(callback) {
      callback(null, Pudding.whisk({
        abi: abi,
        binary: binary,
        contract_name: "Example",
        //address: "0xe6e1652a0397e078f434d6dda181b218cfd42e01", // random; meant to check default values
      }));
    });
  });

  describe("when using generator/loader:", function() {
    tests(function(callback) {
      var dirPath = temp.mkdirSync('ether-pudding-generator');

      PuddingGenerator.save({
        "Example": {
          abi: abi,
          binary: binary,
         // address: "0xe6e1652a0397e078f434d6dda181b218cfd42e01"
        }
      }, dirPath, {removeExisting: true});

      var scope = {};

      PuddingLoader.load(dirPath, Pudding, scope, function(err, names) {
        callback(err, scope["Example"]);
      });
    });
  });

});
