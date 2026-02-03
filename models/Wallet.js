const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Wallet = sequelize.define('Wallet', {
        wallet_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
        },
        balance: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        currency: {
            type: DataTypes.STRING(10),
            defaultValue: 'VND',
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'wallets',
        timestamps: false,
    });

    Wallet.associate = (models) => {
        Wallet.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
        Wallet.hasMany(models.WalletTransaction, {
            foreignKey: 'wallet_id',
            as: 'transactions',
        });
    };

    return Wallet;
};
