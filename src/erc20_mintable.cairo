use starknet::ContractAddress;

#[starknet::contract]
mod BraavosTestERC20 {
    use openzeppelin::token::erc20::erc20::ERC20Component;
    use starknet::get_caller_address;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        admin: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, name: felt252, symbol: felt252, decimals: u8) {
        let caller = get_caller_address();
        self.admin.write(caller);
        self.erc20.initializer(name, symbol, decimals);
    }

    #[abi(embed_v0)]
    impl ERC20ExternalImpl of ERC20Component::ERC20<ContractState> {}

    #[abi(embed_v0)]
    impl MintableImpl of IERC20Mintable<ContractState> {
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');
            self.erc20.mint(recipient, amount);
        }
    }
}


