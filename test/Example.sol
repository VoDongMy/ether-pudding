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
  event ExampleEvent(address indexed _from);
}
