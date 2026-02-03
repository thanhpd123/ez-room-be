const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Preorder = sequelize.define('Preorder', {
        preorder_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        room_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('pending', 'confirmed', 'cancelled', 'refunded'),
            defaultValue: 'pending',
        },
        expired_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'preorders',
        timestamps: false,
    });

    Preorder.associate = (models) => {
        Preorder.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
        Preorder.belongsTo(models.Room, {
            foreignKey: 'room_id',
            as: 'room',
        });
    };

    return Preorder;
};
