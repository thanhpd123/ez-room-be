const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const WalletTransaction = sequelize.define('WalletTransaction', {
        wallet_tx_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        wallet_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        type: {
            type: DataTypes.ENUM('deposit', 'withdraw', 'payment', 'refund'),
            allowNull: false,
        },
        amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        related_type: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
        related_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
    }, {
        tableName: 'wallet_transactions',
        timestamps: false,
    });

    WalletTransaction.associate = (models) => {
        WalletTransaction.belongsTo(models.Wallet, {
            foreignKey: 'wallet_id',
            as: 'wallet',
        });
    };

    return WalletTransaction;
};
