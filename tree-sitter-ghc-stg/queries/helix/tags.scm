; STG bindings as symbols for the picker (sig-named and tag-inference forms).
(binding name: (variable) @name) @definition.function
(binding name: (constructor) @name) @definition.function
(binding (tagged_binder name: (variable) @name)) @definition.function
(binding (tagged_binder name: (constructor) @name)) @definition.function
