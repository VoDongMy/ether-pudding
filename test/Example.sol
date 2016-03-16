contract Example {
  uint public value;
  uint [] public values;
  function Example(uint val) {
    if (val == 0x0) {
      value = 1;
    } else {
      value = val;
    }
  }
  function setValue(uint val) {
    value = val;
    ExampleEvent(msg.sender, 0xaa, 0xbb);
    SecondEvent(0xdead, 0xbeefbeef, 0xdeadbeefdeadbeefdeadbeefdeadbeef, "testing123");
  }
  function getValue() constant returns(uint) {
    return value;
  }
  function parrot(uint val) returns(uint) {
    return val;
  }
  function spendGas(uint val) {
    uint i;
    for (i = 0; i < val; i++) {
      values.push(i); 
    }
  }
  // purposefully designed to trip up any compaction issues with a parser
  event ExampleEvent(address _from, uint8 foo, uint8 bar);
  // purposefullly design to be misaligned
  event SecondEvent(uint16 x, uint32 y, uint z, bytes32 info);
}
