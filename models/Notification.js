const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Notification = sequelize.define('Notification', {
        notification_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        type: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        title: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        content: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        related_entity_type: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        related_entity_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        is_read: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'notifications',
        timestamps: false,
    });

    Notification.associate = (models) => {
        Notification.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
    };

    return Notification;
};
